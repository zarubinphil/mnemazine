#!/usr/bin/env node
// KB topic search — an orchestrator-led agent swarm over the live vault.
// Pipeline (mirrors the swarm playbook: recon -> fan-out -> fan-in):
//   1. RECON   (0 tokens): keyword-score every note, keep the top candidates.
//              --deep also asks the orchestrator to widen the query first.
//   2. FAN-OUT (swarm): shard candidates; a bounded pool of agents reads each
//              shard and returns findings (note / source / insight / relevance).
//              Workers write to a shared store (the result), never chat. One
//              failing worker never blocks the swarm (inner+outer try/catch).
//   3. FAN-IN  (synthesis): the orchestrator dedups + synthesizes findings into
//              a Russian "Справка" report. Generator != evaluator — workers
//              extract, the orchestrator judges and writes.
//   node scripts/mnemazine-kb-search.mjs --topic "..." [--vault <p>] [--deep]
// Default is conservative (0 tokens, local extract). --deep / MNEMAZINE_DEEP=1
// engages the LLM swarm. Report written to reports/ as Markdown; path printed.
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { resolveVault } from './mnemazine-paths.mjs'
import { llmAvailable, llmJson, fenceUntrusted } from './mnemazine-llm.mjs'

const argv = process.argv.slice(2)
const SELFTEST = argv.includes('--selftest')
function arg(name, fb = '') {
  const hit = argv.find(a => a === `--${name}` || a.startsWith(`--${name}=`))
  if (!hit) return fb
  return hit.includes('=') ? hit.split('=').slice(1).join('=') : argv[argv.indexOf(hit) + 1] || fb
}

const DEEP = argv.includes('--deep') || process.env.MNEMAZINE_DEEP === '1'
const PROVIDER = arg('provider', process.env.MNEMAZINE_LLM || 'claude')
const CONCURRENCY = Number(arg('concurrency', process.env.MNEMAZINE_CONCURRENCY || '4'))
const MAX_NOTES = Number(arg('max-notes', '60'))     // candidate cap fed to the swarm
const SHARD_SIZE = Number(arg('shard-size', '6'))    // notes per agent
const EXCERPT = 2500                                  // chars of each note shown to an agent

// --- helpers -----------------------------------------------------------------
async function walk(dir, out = []) {
  for (const e of await fs.readdir(dir, { withFileTypes: true }).catch(() => [])) {
    if (e.name.startsWith('.')) continue
    const full = path.join(dir, e.name)
    if (e.isDirectory()) await walk(full, out)
    else if (e.name.endsWith('.md')) out.push(full)
  }
  return out
}

const STOP = new Set(['the', 'and', 'для', 'что', 'как', 'это', 'про', 'или', 'был', 'are', 'with', 'из', 'на', 'по', 'не', 'от'])
const tokens = s => (String(s).toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) || []).filter(t => !STOP.has(t))

function scoreNote(text, rel, terms) {
  const hay = (rel + '\n' + text).toLowerCase()
  let score = 0
  for (const t of terms) {
    let from = 0, n = 0
    while ((from = hay.indexOf(t, from)) !== -1) { n++; from += t.length; if (n >= 8) break }
    score += n
    if (rel.toLowerCase().includes(t)) score += 4   // title/path hit weighs more
  }
  return score
}

// Pull a few keyword-centered snippets — the local (0-token) "finding".
function snippets(text, terms, max = 3) {
  const out = []
  const lower = text.toLowerCase()
  for (const t of terms) {
    const i = lower.indexOf(t)
    if (i === -1) continue
    const s = Math.max(0, i - 120), e = Math.min(text.length, i + 200)
    const snip = text.slice(s, e).replace(/\s+/g, ' ').trim()
    if (snip && !out.includes(snip)) out.push(snip)
    if (out.length >= max) break
  }
  return out
}

// Bounded-concurrency pool — the swarm. One failing task never blocks the rest.
async function mapLimit(items, limit, fn) {
  let i = 0
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length || 1)) }, async () => {
    while (i < items.length) { const idx = i++; await fn(items[idx], idx) }
  })
  await Promise.all(workers)
}

const FINDINGS_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['findings'],
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        required: ['note', 'insight', 'relevance'],
        properties: {
          note: { type: 'string' },
          source: { type: 'string' },
          insight: { type: 'string' },
          relevance: { type: 'integer', minimum: 1, maximum: 5 }
        }
      }
    }
  }
}

const SYNTH_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['summary', 'themes', 'gaps'],
  properties: {
    summary: { type: 'string' },
    themes: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false, required: ['title', 'points'],
        properties: { title: { type: 'string' }, points: { type: 'array', items: { type: 'string' } } }
      }
    },
    connections: { type: 'array', items: { type: 'string' } },
    contradictions: { type: 'array', items: { type: 'string' } },
    gaps: { type: 'array', items: { type: 'string' } },
    next: { type: 'array', items: { type: 'string' } }
  }
}

// --- orchestrator: widen the query (deep only) -------------------------------
async function widen(topic) {
  if (!DEEP || !llmAvailable(PROVIDER)) return tokens(topic)
  try {
    const out = await llmJson(
      `Тема поиска по базе знаний: "${topic}". Дай ключевые слова и синонимы (рус+англ) для полнотекстового поиска по заметкам — только список терминов, без объяснений.`,
      { type: 'object', additionalProperties: false, required: ['terms'], properties: { terms: { type: 'array', items: { type: 'string' } } } },
      { provider: PROVIDER }
    )
    const terms = new Set(tokens(topic))
    for (const t of out.terms || []) for (const w of tokens(t)) terms.add(w)
    return [...terms]
  } catch (e) {
    console.error(`[kb-search] query widening failed: ${e.message}; using raw terms`)
    return tokens(topic)
  }
}

// --- worker: extract findings from one shard ---------------------------------
async function extractShard(topic, shard) {
  if (DEEP && llmAvailable(PROVIDER)) {
    const blob = shard.map(n =>
      fenceUntrusted('NOTE', `### ${n.rel}\n${n.text.slice(0, EXCERPT)}`)).join('\n\n')
    const prompt = `Ты агент-исследователь. Тема: "${topic}".
Из заметок ниже выбери ТОЛЬКО релевантное теме. Для каждой находки: note (путь заметки), source (URL/ссылка из заметки, если есть), insight (1-2 предложения по-русски — что важного для темы), relevance (1-5). Ничего не выдумывай сверх заметок.

${blob}`
    try {
      const out = await llmJson(prompt, FINDINGS_SCHEMA, { provider: PROVIDER, tools: [] })
      return (out.findings || []).filter(f => f.insight && f.relevance >= 2)
    } catch (e) {
      console.error(`[kb-search] shard agent failed: ${e.message}; local fallback`)
    }
  }
  // Local (0-token) fallback: snippet extraction.
  const terms = tokens(topic)
  return shard.flatMap(n => {
    const snips = snippets(n.text, terms)
    return snips.length ? [{ note: n.rel, source: n.url || '', insight: snips.join(' … '), relevance: Math.min(5, 2 + Math.floor(n.score / 4)) }] : []
  })
}

// --- orchestrator: synthesize findings into a report -------------------------
async function synthesize(topic, findings) {
  if (DEEP && llmAvailable(PROVIDER) && findings.length) {
    const blob = findings.map(f => `- [${f.note}] (rel ${f.relevance}) ${f.insight}${f.source ? ` <${f.source}>` : ''}`).join('\n')
    const prompt = `Ты оркестратор. Собери из находок агентов справку по теме "${topic}" на РУССКОМ, стиль humanizer — живо, ясно, по делу, без воды и канцелярита. Дедуплицируй, сгруппируй по под-темам (themes), отметь связи (connections), противоречия (contradictions), пробелы знаний (gaps) и следующие шаги (next). Не выдумывай сверх находок.

Находки:
${blob}`
    try { return await llmJson(prompt, SYNTH_SCHEMA, { provider: PROVIDER }) }
    catch (e) { console.error(`[kb-search] synthesis failed: ${e.message}; local assembly`) }
  }
  // Local assembly: group by note, no LLM.
  const byNote = new Map()
  for (const f of findings) {
    if (!byNote.has(f.note)) byNote.set(f.note, [])
    byNote.get(f.note).push(f.insight)
  }
  const themes = [...byNote.entries()]
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, 12)
    .map(([note, points]) => ({ title: note, points: [...new Set(points)] }))
  return {
    summary: `Найдено ${findings.length} совпадений в ${byNote.size} заметках по теме «${topic}» (локальный поиск без LLM).`,
    themes, connections: [], contradictions: [], gaps: [], next: []
  }
}

// --- report rendering --------------------------------------------------------
function slugify(s) { return String(s).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'topic' }

function renderReport(topic, report, meta) {
  const L = []
  L.push(`# Справка: ${topic}`, '')
  L.push(`> Поиск по базе знаний · ${meta.stamp} · просмотрено ${meta.scanned} заметок, отобрано ${meta.candidates}, находок ${meta.findings} · режим: ${meta.deep ? 'рой агентов (deep)' : 'локальный'}`, '')
  L.push('## Главное', '', report.summary || '—', '')
  if (report.themes?.length) {
    L.push('## По под-темам', '')
    for (const t of report.themes) {
      L.push(`### ${t.title}`)
      for (const p of t.points || []) L.push(`- ${p}`)
      L.push('')
    }
  }
  const block = (title, arr) => { if (arr?.length) { L.push(`## ${title}`, ''); for (const x of arr) L.push(`- ${x}`); L.push('') } }
  block('Связи', report.connections)
  block('Противоречия', report.contradictions)
  block('Пробелы', report.gaps)
  block('Дальше', report.next)
  return L.join('\n')
}

// --- main --------------------------------------------------------------------
async function run(topic, vault, outDir) {
  const stamp = new Date().toISOString()
  const terms = await widen(topic)
  // RECON
  const files = await walk(vault)
  const scored = []
  for (const f of files) {
    const text = await fs.readFile(f, 'utf8').catch(() => '')
    if (!text) continue
    const rel = path.relative(vault, f)
    const score = scoreNote(text, rel, terms)
    if (score > 0) scored.push({ rel, text, score, url: text.match(/https?:\/\/\S+/)?.[0] || '' })
  }
  scored.sort((a, b) => b.score - a.score)
  const candidates = scored.slice(0, MAX_NOTES)
  // FAN-OUT
  const shards = []
  for (let i = 0; i < candidates.length; i += SHARD_SIZE) shards.push(candidates.slice(i, i + SHARD_SIZE))
  const findings = []
  await mapLimit(shards, DEEP ? CONCURRENCY : 1, async shard => {
    try { findings.push(...await extractShard(topic, shard)) }
    catch (e) { console.error(`[kb-search] shard failed: ${e.message}`) }
  })
  findings.sort((a, b) => (b.relevance || 0) - (a.relevance || 0))
  // FAN-IN
  const report = await synthesize(topic, findings)
  const md = renderReport(topic, report, { stamp, scanned: files.length, candidates: candidates.length, findings: findings.length, deep: DEEP && llmAvailable(PROVIDER) })
  await fs.mkdir(outDir, { recursive: true })
  const out = path.join(outDir, `search-${slugify(topic)}-${stamp.slice(0, 10)}-${Date.now()}.md`)
  await fs.writeFile(out, md, 'utf8')
  return out
}

async function selftest() {
  const assert = (c, m) => { if (!c) throw new Error(`selftest: ${m}`) }
  const tmp = await fs.mkdtemp(path.join((await import('node:os')).tmpdir(), 'kbsearch-'))
  const vault = path.join(tmp, 'vault'); await fs.mkdir(vault, { recursive: true })
  await fs.writeFile(path.join(vault, 'harness.md'), '# Agent harness\nСреда важнее модели. Контекст это бюджет. https://example.com/x', 'utf8')
  await fs.writeFile(path.join(vault, 'coffee.md'), '# Кофе\nЭспрессо и молоко.', 'utf8')
  const out = await run('agent harness контекст', vault, path.join(tmp, 'reports'))
  const md = await fs.readFile(out, 'utf8')
  assert(md.includes('Справка:'), 'report has header')
  assert(md.includes('harness.md'), 'relevant note surfaced')
  assert(!md.includes('coffee.md'), 'irrelevant note excluded')
  await fs.rm(tmp, { recursive: true, force: true })
  console.log('selftest ok')
}

if (SELFTEST) {
  selftest().catch(e => { console.error(e.message); process.exit(1) })
} else {
  const topic = arg('topic') || argv.find(a => !a.startsWith('--'))
  if (!topic) { console.error('Usage: mnemazine-kb-search.mjs --topic "<тема>" [--deep] [--vault <p>]'); process.exit(1) }
  const vault = resolveVault({ cli: arg('vault') })
  const outDir = path.resolve(arg('out', process.env.MNEMAZINE_REPORTS || path.join(process.cwd(), 'reports')))
  run(topic, vault, outDir)
    .then(p => console.log(p))
    .catch(e => { console.error(`[kb-search] ${e.message}`); process.exit(1) })
}
