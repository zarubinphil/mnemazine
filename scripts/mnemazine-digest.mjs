#!/usr/bin/env node
// Phase D — Russian human-readable digest, written AFTER Graphify.
// For each note: a humanizer-style Russian "Справка" section (Что это / О чём /
// Почему важно мне / Связи), with real connections pulled from the Graphify
// graph. Plus one session summary note mapping all processed atoms — so the
// knowledge is trivially reusable later.
//   node scripts/mnemazine-digest.mjs --vault <path> [--provider claude|codex] [--force]
// Needs an LLM (Claude primary). No-op for notes already carrying a Справка
// unless --force. Default pipeline never calls this — it is a deep/opt-in stage.
import { promises as fs, readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { llmAvailable, llmJson, fenceUntrusted } from './mnemazine-llm.mjs'

const ROOT = process.env.MNEMAZINE_ROOT || path.resolve(process.cwd())
const argv = process.argv.slice(2)
function arg(name, fb = '') {
  const hit = argv.find(a => a === `--${name}` || a.startsWith(`--${name}=`))
  if (!hit) return fb
  return hit.includes('=') ? hit.split('=').slice(1).join('=') : argv[argv.indexOf(hit) + 1] || fb
}

const VAULT = path.resolve(arg('vault', process.env.MNEMAZINE_VAULT || path.join(ROOT, 'vault')))
const GRAPH = path.resolve(arg('graph', path.join(VAULT, 'graphify-out/graph.json')))
const SESSION = arg('session', new Date().toISOString().slice(0, 10))
const PROVIDER = arg('provider', process.env.MNEMAZINE_LLM || 'claude')
const FORCE = argv.includes('--force')
const LIMIT = Number(arg('limit', '0')) // 0 = no cap
const SPRAVKA = '## Справка'
// Personal project context stays out of the public repo. Set it once locally:
// env MNEMAZINE_OWNER_CONTEXT, or a gitignored file .mnemazine/owner-context.txt.
function ownerContext() {
  if (process.env.MNEMAZINE_OWNER_CONTEXT) return process.env.MNEMAZINE_OWNER_CONTEXT.trim()
  const f = path.join(ROOT, '.mnemazine/owner-context.txt')
  if (existsSync(f)) { try { return readFileSync(f, 'utf8').trim() } catch {} }
  return 'ваших проектов и работы'
}
const OWNER_CONTEXT = ownerContext()

const DIGEST_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['zagolovok', 'chto_eto', 'o_chyom', 'pochemu_vazhno'],
  properties: {
    zagolovok: { type: 'string' },
    chto_eto: { type: 'string' },
    o_chyom: { type: 'string' },
    pochemu_vazhno: { type: 'string' }
  }
}

function digestPrompt(noteText, connections) {
  const conns = connections.length ? connections.map(c => `- ${c}`).join('\n') : '- (связей в графе пока нет)'
  return `Ты пишешь короткую человеческую справку по заметке знаний на РУССКОМ языке. Стиль humanizer: живо, ясно, по делу, без канцелярита и воды. Не выдумывай фактов сверх заметки.

Дай четыре поля:
- "zagolovok": точный человеческий заголовок (что это за знание).
- "chto_eto": 1-2 предложения — что это такое.
- "o_chyom": 1-2 предложения — о чём это, суть.
- "pochemu_vazhno": 1-2 предложения — почему это полезно в контексте ${OWNER_CONTEXT}.

Связанные знания из графа (для контекста, не пересказывай их):
${conns}

${fenceUntrusted('ЗАМЕТКА', noteText.slice(0, 12000))}`
}

// Map each note (vault-relative path) to neighbor labels from the Graphify graph.
async function loadConnections() {
  const byNote = new Map()
  let graph
  try { graph = JSON.parse(await fs.readFile(GRAPH, 'utf8')) } catch { return byNote }
  const edgeKey = Array.isArray(graph.links) ? 'links' : Array.isArray(graph.edges) ? 'edges' : 'links'
  const labelById = new Map()
  const fileById = new Map()
  for (const n of graph.nodes || []) {
    if (!n || !n.id) continue
    labelById.set(n.id, n.label || n.norm_label || n.id)
    if (n.source_file) fileById.set(n.id, n.source_file)
  }
  const neighbors = new Map() // id -> Set(label)
  for (const e of graph[edgeKey] || []) {
    if (!e || e.source == null || e.target == null) continue
    for (const [a, b] of [[e.source, e.target], [e.target, e.source]]) {
      if (!neighbors.has(a)) neighbors.set(a, new Set())
      const lbl = labelById.get(b)
      if (lbl) neighbors.get(a).add(lbl)
    }
  }
  for (const [id, file] of fileById) {
    const rel = file.replace(/^\.\//, '')
    const list = [...(neighbors.get(id) || [])].slice(0, 12)
    if (list.length) byNote.set(rel, list)
  }
  return byNote
}

async function walk(dir) {
  const out = []
  for (const item of await fs.readdir(dir, { withFileTypes: true }).catch(() => [])) {
    const p = path.join(dir, item.name)
    if (item.isDirectory()) {
      if (/graphify-out|\.git|_digest/.test(item.name)) continue
      out.push(...await walk(p))
    } else if (item.isFile() && p.endsWith('.md')) out.push(p)
  }
  return out
}

function titleOf(text, file) {
  return text.match(/^title:\s*"([^"]+)"/m)?.[1] || text.match(/^#\s+(.+)$/m)?.[1]?.trim() || path.basename(file, '.md')
}

function spravkaBlock(d, connections) {
  const conns = connections.length ? connections.map(c => `- [[${c.replace(/\.md$/, '')}]]`).join('\n') : '- (связи появятся после графа)'
  return `${SPRAVKA}

**${d.zagolovok}**

- **Что это:** ${d.chto_eto}
- **О чём:** ${d.o_chyom}
- **Почему важно мне:** ${d.pochemu_vazhno}

**Связи:**
${conns}
`
}

async function main() {
  if (!llmAvailable(PROVIDER)) {
    console.log(JSON.stringify({ ok: false, reason: `llm provider '${PROVIDER}' unavailable`, written: 0 }))
    process.exit(0)
  }
  const connByNote = await loadConnections()
  const files = await walk(VAULT)
  const summary = []
  let written = 0
  for (const file of files) {
    if (LIMIT && written >= LIMIT) break
    const text = await fs.readFile(file, 'utf8')
    if (text.includes(SPRAVKA) && !FORCE) continue
    const rel = path.relative(VAULT, file)
    const connections = connByNote.get(rel) || []
    let d
    try {
      d = await llmJson(digestPrompt(text, connections), DIGEST_SCHEMA, { provider: PROVIDER })
    } catch (err) {
      console.error(`[digest] failed for ${rel}: ${err.message}`)
      continue
    }
    if (!d?.zagolovok) continue
    const stripped = FORCE ? text.replace(new RegExp(`\\n*${SPRAVKA}[\\s\\S]*?(?=\\n## |$)`, 'm'), '\n') : text
    const block = spravkaBlock(d, connections)
    await fs.writeFile(file, `${stripped.trimEnd()}\n\n${block}`, 'utf8')
    summary.push({ rel, title: titleOf(text, file), zagolovok: d.zagolovok, connections })
    written += 1
  }

  // Session summary note — the reuse surface: what was learned + connection map.
  if (summary.length) {
    const dir = path.join(VAULT, '_digest')
    await fs.mkdir(dir, { recursive: true })
    const body = [
      `---\ntitle: "Сводка знаний — ${SESSION}"\ntype: "knowledge-digest"\nsource_ref: "digest:${SESSION}"\n---`,
      `\n# Сводка знаний — ${SESSION}\n`,
      `Обработано заметок: ${summary.length}. Ниже — что узнано и как связано.\n`,
      ...summary.map(s => `## ${s.zagolovok}\n\n- Заметка: [[${s.rel.replace(/\.md$/, '')}]]\n- Связи: ${s.connections.length ? s.connections.map(c => `[[${c.replace(/\.md$/, '')}]]`).join(', ') : '—'}\n`)
    ].join('\n')
    await fs.writeFile(path.join(dir, `Сводка-${SESSION}.md`), body, 'utf8')
  }

  console.log(JSON.stringify({ ok: true, provider: PROVIDER, written, summary: summary.length, graph: connByNote.size ? GRAPH : 'none' }, null, 2))
}

main().catch(err => { console.error(err.message || err); process.exit(1) })
