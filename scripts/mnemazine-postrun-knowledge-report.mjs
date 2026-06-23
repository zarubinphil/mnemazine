#!/usr/bin/env node
import { promises as fs } from 'node:fs'
import fsSync from 'node:fs'
import path from 'node:path'
import { resolveVault } from './mnemazine-paths.mjs'

const argv = process.argv.slice(2)
const ROOT = process.env.MNEMAZINE_ROOT || path.resolve(process.cwd())

function arg(name, fallback = '') {
  const hit = argv.find(a => a === `--${name}` || a.startsWith(`--${name}=`))
  if (!hit) return fallback
  return hit.includes('=') ? hit.split('=').slice(1).join('=') : argv[argv.indexOf(hit) + 1] || fallback
}

function flag(name) {
  return argv.includes(`--${name}`)
}

const VAULT = resolveVault({ cli: arg('vault') })
const REPORTS = path.resolve(arg('reports', process.env.MNEMAZINE_REPORTS || path.join(ROOT, 'reports')))
const RUN_ID = arg('run-id', new Date().toISOString().slice(0, 10))
const TITLE = arg('title', 'Mnemazine knowledge brief')
const LOGS = arg('logs', '')
const RESULTS_JSON = arg('results-json', '')
const FINAL_FILES_JSON = arg('final-files-json', '')
const SINCE_DAYS = Number(arg('since-days', process.env.MNEMAZINE_POSTRUN_SINCE_DAYS || '7'))

const DEFAULT_LOGS = (process.env.MNEMAZINE_POSTRUN_LOGS || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean)

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
}

function mdEsc(s) {
  return String(s ?? '').replace(/\|/g, '\\|').replace(/\n+/g, ' ').trim()
}

function rel(file) {
  return file && file.startsWith(VAULT) ? path.relative(VAULT, file) : file
}

function clean(text) {
  return String(text || '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\r/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function present(text) {
  return String(text || '')
    .replace(/\bIMG_\d+(?:\.(?:WEBP|PNG|JPE?G|HEIC|TIFF|MOV|MP4))?\b/gi, 'локальный визуальный источник')
    .replace(/\btemp_image[_-][\w.-]+/gi, 'локальный визуальный источник')
    .replace(/\b[\w.-]+\.(?:WEBP|PNG|JPE?G|HEIC|TIFF|MOV|MP4)\b/gi, 'локальный медиафайл')
    .trim()
}

function firstPara(text, max = 420) {
  const para = clean(text).split(/\n\s*\n/).map(x => x.replace(/\n/g, ' ').trim()).find(Boolean) || ''
  return para.length > max ? `${para.slice(0, max - 1).trim()}...` : para
}

function titleOf(text, file) {
  return text.match(/^title:\s*["']?(.+?)["']?\s*$/m)?.[1]?.trim() ||
    text.match(/^#\s+(.+)$/m)?.[1]?.trim() ||
    path.basename(file || 'untitled', '.md')
}

function extractSection(text, names) {
  for (const name of names) {
    const re = new RegExp(`^##\\s+${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:\\s|$)[^\\n]*\\n([\\s\\S]*?)(?=^##\\s+|\\z)`, 'mi')
    const hit = text.match(re)
    if (hit) return clean(hit[1])
  }
  return ''
}

async function walk(dir) {
  const out = []
  for (const item of await fs.readdir(dir, { withFileTypes: true }).catch(() => [])) {
    if (['.git', '.obsidian'].includes(item.name) || item.name.startsWith('graphify-out')) continue
    const p = path.join(dir, item.name)
    if (item.isDirectory()) out.push(...await walk(p))
    else if (item.isFile() && item.name.endsWith('.md')) out.push(p)
  }
  return out
}

let allMdCache = null
async function findByBasename(name) {
  allMdCache ||= await walk(VAULT)
  return allMdCache.find(file => path.basename(file) === name) || ''
}

async function resolveNote(raw) {
  if (!raw || typeof raw !== 'string') return ''
  const text = raw.trim()
  if (!text || text.includes('\n') || text.startsWith('Группа ') || text.startsWith('Смешанный материал')) return ''
  if (path.isAbsolute(text) && fsSync.existsSync(text)) return text
  if (text.includes('/') && text.endsWith('.md')) {
    const full = path.join(VAULT, text)
    if (fsSync.existsSync(full)) return full
  }
  if (text.endsWith('.md')) return await findByBasename(path.basename(text))
  return ''
}

function parseJsonLine(line) {
  const s = line.trim()
  if (!s.startsWith('{') || !s.includes('"group_id"')) return null
  try {
    const obj = JSON.parse(s)
    if (obj && obj.group_id && obj.outcome && Array.isArray(obj.files)) return obj
  } catch {}
  return null
}

async function loadResults() {
  const rows = []
  if (RESULTS_JSON) {
    const raw = JSON.parse(await fs.readFile(RESULTS_JSON, 'utf8'))
    if (Array.isArray(raw)) rows.push(...raw)
    else if (Array.isArray(raw.processResults)) rows.push(...raw.processResults)
  }
  const logs = LOGS ? LOGS.split(',').map(s => s.trim()).filter(Boolean) : DEFAULT_LOGS
  for (const log of logs) {
    if (!fsSync.existsSync(log)) continue
    for (const line of (await fs.readFile(log, 'utf8')).split(/\n/)) {
      const obj = parseJsonLine(line)
      if (obj) rows.push(obj)
    }
  }
  if (!rows.length) rows.push(...await loadRecentVaultResults(SINCE_DAYS))
  const byGroup = new Map()
  for (const row of rows) byGroup.set(row.group_id, row)
  return [...byGroup.values()]
}

async function loadRecentVaultResults(days) {
  const files = await walk(VAULT)
  const cutoff = Date.now() - Math.max(1, Number(days) || 7) * 24 * 60 * 60 * 1000
  const rows = []
  for (const file of files) {
    const stat = await fs.stat(file).catch(() => null)
    if (!stat || stat.mtimeMs < cutoff) continue
    const id = path.relative(VAULT, file).replace(/[^a-zA-Z0-9а-яА-ЯёЁ_-]+/g, '-')
    rows.push({
      group_id: `vault-${id}`,
      outcome: 'note',
      files: [file],
      filename: file,
    })
  }
  return rows
}

function fileCount(result) {
  return new Set((result.files || []).map(f => path.basename(f))).size
}

function sectionOf(file) {
  if (!file) return 'не найдено'
  const parts = path.relative(VAULT, file).split(path.sep)
  return parts[0] || 'корень'
}

function splitAtoms(text) {
  const fromSection = extractSection(text, ['Атомизация', 'Атомизировано'])
  const raw = fromSection || ''
  return raw.split(/\n+/)
    .map(line => line.replace(/^[-*]\s*/, '').replace(/^`([^`]+)`:\s*/, '$1 - ').trim())
    .filter(line => line && !line.startsWith('#'))
    .slice(0, 8)
}

function scoreRecord(record) {
  const text = `${record.title} ${record.summary} ${record.helps}`.toLowerCase()
  let score = 0
  const weights = [
    ['agent', 16], ['codex', 15], ['claude', 15], ['mnemazine', 14], ['мнемозина', 14],
    ['legal', 14], ['юрист', 14], ['investor', 13], ['startup', 13], ['стартап', 13],
    ['quick wins', 12], ['workflow', 11], ['portal', 10], ['marketplace', 10],
    ['промпт', 8], ['skill', 8], ['graph', 7], ['dashboard', 7],
  ]
  for (const [term, value] of weights) if (text.includes(term)) score += value
  if (record.outcomes.note) score += 6
  if (record.outcomes.atoms) score += 5
  score += Math.min(record.files, 10)
  return score
}

function inferAction(record) {
  const text = `${record.title} ${record.summary}`.toLowerCase()
  if (record.next && record.next !== '—') return record.next
  if (text.includes('legal') || text.includes('юрист') || text.includes('lexora')) return 'Собрать product spec для Legal/Femida: витрина, intake, кабинет, документы, статусы.'
  if (text.includes('investor') || text.includes('cap table') || text.includes('esop') || text.includes('стартап')) return 'Собрать investor-ready data room pack: документы, cap table, ESOP, agreements, memo.'
  if (text.includes('agent') || text.includes('codex') || text.includes('claude')) return 'Перенести в Agent OS blueprint: роли, команды, memory, trace, gates, dashboard.'
  if (text.includes('quick wins') || text.includes('support') || text.includes('sales')) return 'Сделать AI quick-wins offer: боль, данные, MVP, риск, цена, демо.'
  if (text.includes('промпт') || text.includes('prompt')) return 'Добавить в slash-command pack и протестировать на одной реальной задаче.'
  return 'Прочитать ноту, выбрать один применимый проект и превратить в маленькое действие.'
}

function clusterOf(record) {
  const text = `${record.title} ${record.summary}`.toLowerCase()
  if (text.includes('legal') || text.includes('lexora') || text.includes('юрист') || text.includes('marketplace')) return 'Legal / Femida'
  if (text.includes('investor') || text.includes('cap table') || text.includes('esop') || text.includes('founder') || text.includes('shareholder')) return 'Investor-ready startup'
  if (text.includes('agent') || text.includes('codex') || text.includes('claude') || text.includes('mnemazine') || text.includes('graph')) return 'Agent OS'
  if (text.includes('quick wins') || text.includes('support') || text.includes('sales') || text.includes('onboarding')) return 'AI business offers'
  if (text.includes('prompt') || text.includes('промпт') || text.includes('slash')) return 'Prompts / commands'
  return 'Other useful knowledge'
}

async function buildRecords(results) {
  const records = new Map()
  for (const result of results) {
    const raw = result.filename || result.note_md || ''
    const noteFile = await resolveNote(raw)
    const key = noteFile || raw || `${result.outcome}:${result.group_id}`
    const record = records.get(key) || {
      key,
      file: noteFile,
      raw,
      title: '',
      section: '',
      summary: '',
      helps: '',
      next: '',
      atoms: [],
      files: 0,
      groups: [],
      outcomes: {},
      cluster: '',
      score: 0,
    }
    record.groups.push(result.group_id)
    record.files += fileCount(result)
    record.outcomes[result.outcome] = (record.outcomes[result.outcome] || 0) + 1
    if (noteFile && fsSync.existsSync(noteFile)) {
      const text = await fs.readFile(noteFile, 'utf8')
      record.title ||= titleOf(text, noteFile)
      record.section ||= sectionOf(noteFile)
      record.summary ||= firstPara(extractSection(text, ['Короткий ответ', 'Что это и зачем', 'Что это', 'Суть', 'Полное объяснение', 'What This Is']), 430)
      record.helps ||= firstPara(extractSection(text, ['Как поможет мне', '🎯 Как поможет мне', 'Как это поможет мне', 'Зачем мне']), 340)
      record.next ||= firstPara(extractSection(text, ['Следующий ход', 'Следующее действие', 'Next Action']), 260)
      record.atoms = record.atoms.length ? record.atoms : splitAtoms(text)
    } else {
      record.title ||= raw ? firstPara(raw, 100) : result.group_id
      record.section ||= 'не найдено'
      record.summary ||= result.helps || ''
      record.next ||= result.next_action || ''
    }
    record.title = present(record.title) || 'Локальное знание'
    record.summary = present(record.summary)
    record.helps = present(record.helps)
    record.next = present(record.next)
    record.atoms = record.atoms.map(atom => present(atom)).filter(Boolean)
    record.next = inferAction(record)
    record.cluster = clusterOf(record)
    record.score = scoreRecord(record)
    records.set(key, record)
  }
  return [...records.values()]
}

function outcomeLabel(record) {
  return Object.entries(record.outcomes).map(([k, v]) => `${k}:${v}`).join(', ')
}

function noteLink(record) {
  if (!record.file) return '—'
  return `[${present(path.basename(record.file, '.md')) || 'Локальное знание'}](${record.file})`
}

function top20(records) {
  return records
    .filter(r => r.outcomes.note || r.outcomes.atoms)
    .sort((a, b) => b.score - a.score || b.files - a.files)
    .slice(0, 20)
}

function groupByCluster(records) {
  const map = new Map()
  for (const record of records) {
    const list = map.get(record.cluster) || []
    list.push(record)
    map.set(record.cluster, list)
  }
  return [...map.entries()].sort((a, b) => b[1].length - a[1].length)
}

function mermaid(records) {
  const clusters = groupByCluster(records.filter(r => r.outcomes.note || r.outcomes.atoms))
  const lines = ['mindmap', '  root((Mnemazine batch))']
  for (const [cluster, items] of clusters) {
    lines.push(`    ${cluster.replace(/[()]/g, '')}`)
    for (const item of items.slice(0, 8)) {
      lines.push(`      ${item.title.replace(/[:()]/g, '').slice(0, 72)}`)
      for (const atom of item.atoms.slice(0, 3)) lines.push(`        ${atom.replace(/[:()]/g, '').slice(0, 66)}`)
    }
  }
  return lines.join('\n')
}

function markdown({ records, results, mdPath, htmlPath }) {
  const fresh = records.filter(r => r.outcomes.note || r.outcomes.atoms)
  const dup = records.filter(r => !r.outcomes.note && !r.outcomes.atoms && r.outcomes.dup)
  const action = top20(records)
  const rows = fresh
    .sort((a, b) => a.cluster.localeCompare(b.cluster, 'ru') || b.score - a.score)
    .map(r => `| ${mdEsc(r.cluster)} | ${mdEsc(outcomeLabel(r))} | ${r.files} | ${noteLink(r)} | ${mdEsc(r.summary || '—')} | ${mdEsc(r.helps || '—')} | ${mdEsc(r.next || '—')} |`)
  const actionRows = action.map((r, i) => `| ${i + 1} | ${mdEsc(r.cluster)} | ${noteLink(r)} | ${mdEsc(r.next)} |`)
  const dupRows = dup
    .sort((a, b) => b.files - a.files)
    .map(r => `| ${mdEsc(r.cluster)} | ${r.files} | ${noteLink(r)} | ${mdEsc(r.summary || r.title)} |`)
  return `# Mnemazine visual knowledge report

Run: ${RUN_ID}  
HTML: ${htmlPath}

## Сводка

- Смысловых групп: **${results.length}**.
- Новые/обновленные цели знаний: **${fresh.length}**.
- Дубль-цели: **${dup.length}**.
- Визуальная логика: крупные кластеры -> ноты -> малые атомы -> действия.

## Карта знаний

\`\`\`mermaid
${mermaid(records)}
\`\`\`

## Новые и обновленные знания

| Кластер | Исход | Файлов | Нота | Что это | Как полезно | Следующий ход |
|---|---|---:|---|---|---|---|
${rows.join('\n')}

## Топ-20 к действию

| # | Кластер | Нота | Действие |
|---:|---|---|---|
${actionRows.join('\n')}

## Дубли, которые не потеряны

| Кластер | Файлов | Нота | Что уже покрыто |
|---|---:|---|---|
${dupRows.join('\n')}
`
}

function html({ records, results }) {
  const fresh = records.filter(r => r.outcomes.note || r.outcomes.atoms)
  const dup = records.filter(r => !r.outcomes.note && !r.outcomes.atoms && r.outcomes.dup)
  const actions = top20(records)
  const clusters = groupByCluster(fresh)
  const css = `
:root{--bg:#f5f7fb;--card:#fff;--ink:#111827;--muted:#667085;--line:#e6eaf0;--blue:#0a66ff;--red:#d33a2c;--shadow:0 18px 44px rgba(24,39,75,.08);--ease:cubic-bezier(.23,1,.32,1)}
*{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;background:var(--bg);color:var(--ink);font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text","Segoe UI",sans-serif;letter-spacing:0}
a{color:inherit}.hero{min-height:64vh;padding:72px max(24px,7vw) 48px;background:linear-gradient(180deg,#fff 0%,#f5f7fb 100%);display:grid;align-items:end;border-bottom:1px solid var(--line)}
.eyebrow{font-size:13px;font-weight:760;color:var(--blue);text-transform:uppercase;letter-spacing:.08em}.hero h1{font-size:clamp(44px,7vw,92px);line-height:.94;margin:12px 0 16px;letter-spacing:0;max-width:980px}.lead{font-size:clamp(18px,2vw,24px);line-height:1.35;color:#344054;max-width:820px}
.stats{display:flex;flex-wrap:wrap;gap:10px;margin-top:28px}.stat{background:#fff;border:1px solid var(--line);border-radius:8px;padding:12px 14px;box-shadow:var(--shadow);min-width:144px}.stat strong{display:block;font-size:26px}.stat span{font-size:13px;color:var(--muted)}
main{padding:34px max(18px,6vw) 80px}.section-title{display:flex;justify-content:space-between;gap:16px;align-items:end;margin:34px 0 14px}.section-title h2{font-size:30px;margin:0;letter-spacing:0}.section-title p{max-width:620px;color:var(--muted);line-height:1.5;margin:0}
.map{display:grid;grid-template-columns:280px 1fr;gap:14px}.cluster-nav{display:grid;gap:8px;align-content:start}.pill{display:flex;justify-content:space-between;gap:10px;padding:12px;border:1px solid var(--line);border-radius:8px;background:#fff;box-shadow:var(--shadow);font-weight:680}.pill small{color:var(--muted)}
.tree{background:#fff;border:1px solid var(--line);border-radius:8px;box-shadow:var(--shadow);padding:18px}.branch{border-left:2px solid #dbe4f0;padding:0 0 12px 16px;margin:0 0 10px}.branch h3{margin:0 0 10px;font-size:18px}.leaf{display:grid;gap:6px;margin:8px 0;padding:10px 12px;border:1px solid var(--line);border-radius:8px;background:#fbfcff}.leaf strong{font-size:15px}.atoms{display:flex;flex-wrap:wrap;gap:6px}.atom{font-size:12px;color:#475467;background:#eef3ff;border:1px solid #dce7ff;border-radius:7px;padding:5px 7px}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:14px}.card{background:#fff;border:1px solid var(--line);border-radius:8px;box-shadow:var(--shadow);padding:18px;transition:transform 160ms var(--ease),box-shadow 180ms var(--ease)}.card:hover{transform:translateY(-2px);box-shadow:0 22px 48px rgba(24,39,75,.12)}.card:active{transform:scale(.995)}
.meta{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px}.tag{font-size:12px;color:#344054;background:#f2f4f7;border:1px solid var(--line);border-radius:7px;padding:5px 7px}.card h3{font-size:19px;line-height:1.2;margin:0 0 10px}.card p{font-size:14px;line-height:1.55;color:#344054;margin:8px 0}.next{border-top:1px solid var(--line);margin-top:12px;padding-top:12px;color:#1d2939!important}
.actions-list{counter-reset:step;display:grid;gap:10px}.action{display:grid;grid-template-columns:42px 1fr;gap:12px;background:#fff;border:1px solid var(--line);border-radius:8px;box-shadow:var(--shadow);padding:14px}.action:before{counter-increment:step;content:counter(step);width:32px;height:32px;border-radius:8px;background:var(--ink);color:#fff;display:grid;place-items:center;font-weight:780}.action h3{margin:0 0 5px;font-size:17px}.action p{margin:0;color:#475467;line-height:1.45}.action .cluster{color:var(--blue);font-size:12px;font-weight:760;text-transform:uppercase;letter-spacing:.06em}
.dups{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:10px}.dup{background:#fff;border:1px solid var(--line);border-radius:8px;padding:13px}.dup b{display:block;margin-bottom:5px}.dup span{color:var(--muted);font-size:13px}
@media(max-width:780px){.map{grid-template-columns:1fr}.hero{min-height:auto;padding-top:52px}.section-title{display:block}.section-title p{margin-top:8px}}
@media(prefers-reduced-motion:reduce){*{transition:none!important;scroll-behavior:auto!important}}
`
  const clusterHtml = clusters.map(([name, items]) => `<section class="branch" id="${esc(name)}"><h3>${esc(name)} <span style="color:#98a2b3">${items.length}</span></h3>${items.slice(0, 10).map(item => `<div class="leaf"><strong>${esc(item.title)}</strong><div class="atoms">${(item.atoms.length ? item.atoms : [item.summary || 'малое знание']).slice(0, 4).map(atom => `<span class="atom">${esc(atom)}</span>`).join('')}</div></div>`).join('')}</section>`).join('')
  return `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(TITLE)}</title>
<style>${css}</style>
</head>
<body>
<header class="hero">
  <div>
    <div class="eyebrow">Mnemazine post-run knowledge report</div>
    <h1>Что реально появилось в базе</h1>
    <p class="lead">Светлая карта знаний после прохода: крупные области, ноты, малые атомы и двадцать действий, которые стоит взять в работу.</p>
    <div class="stats">
      <div class="stat"><strong>${results.length}</strong><span>смысловых групп</span></div>
      <div class="stat"><strong>${fresh.length}</strong><span>новых и обновленных целей</span></div>
      <div class="stat"><strong>${dup.length}</strong><span>дубль-целей без потерь</span></div>
      <div class="stat"><strong>${actions.length}</strong><span>действий к запуску</span></div>
    </div>
  </div>
</header>
<main>
  <section class="section-title"><h2>Схема знаний</h2><p>Сначала область, затем ноты, ниже маленькие атомы. Так видно, почему сотни файлов сжались в меньшее число сильных знаний.</p></section>
  <section class="map">
    <nav class="cluster-nav">${clusters.map(([name, items]) => `<a class="pill" href="#${esc(name)}">${esc(name)} <small>${items.length}</small></a>`).join('')}</nav>
    <div class="tree">${clusterHtml}</div>
  </section>
  <section class="section-title"><h2>Топ-20 к действию</h2><p>Мой рекомендуемый порядок: сначала то, что превращается в продукт, workflow или команду без долгой подготовки.</p></section>
  <section class="actions-list">${actions.map(item => `<article class="action"><div><div class="cluster">${esc(item.cluster)}</div><h3>${esc(item.title)}</h3><p>${esc(item.next)}</p></div></article>`).join('')}</section>
  <section class="section-title"><h2>Новые и обновленные знания</h2><p>Полный слой полезных нот и атомов. Дубли вынесены ниже, чтобы не мешали восприятию.</p></section>
  <section class="cards">${fresh.sort((a, b) => b.score - a.score).map(item => `<article class="card"><div class="meta"><span class="tag">${esc(item.cluster)}</span><span class="tag">${esc(outcomeLabel(item))}</span><span class="tag">${item.files} files</span></div><h3>${item.file ? `<a href="file://${esc(item.file)}">${esc(item.title)}</a>` : esc(item.title)}</h3><p>${esc(item.summary || 'Описание не найдено, смотри ноту.')}</p><p><strong>Как полезно:</strong> ${esc(item.helps || 'Привязать к ближайшему проекту.')}</p><p class="next"><strong>Следующий ход:</strong> ${esc(item.next)}</p></article>`).join('')}</section>
  <section class="section-title"><h2>Дубли без потерь</h2><p>Эти материалы уже были покрыты. Они не создали мусорные ноты, но подтвердили существующие знания.</p></section>
  <section class="dups">${dup.sort((a, b) => b.files - a.files).map(item => `<article class="dup"><b>${esc(item.title)}</b><span>${esc(item.cluster)} · ${item.files} files · ${esc(outcomeLabel(item))}</span></article>`).join('')}</section>
</main>
</body>
</html>`
}

await fs.mkdir(REPORTS, { recursive: true })
const results = await loadResults()
const records = await buildRecords(results)
const stamp = new Date().toISOString().slice(0, 10)
const safeRun = RUN_ID.replace(/[^a-zA-Z0-9_-]+/g, '-')
const mdPath = path.join(REPORTS, `${stamp}-${safeRun}-visual-knowledge-report.md`)
const htmlPath = path.join(REPORTS, `${stamp}-${safeRun}-visual-knowledge-report.html`)
await fs.writeFile(mdPath, markdown({ records, results, mdPath, htmlPath }), 'utf8')
await fs.writeFile(htmlPath, html({ records, results }), 'utf8')

if (!flag('quiet')) {
  console.log(JSON.stringify({
    ok: true,
    run_id: RUN_ID,
    groups: results.length,
    records: records.length,
    fresh: records.filter(r => r.outcomes.note || r.outcomes.atoms).length,
    duplicates: records.filter(r => !r.outcomes.note && !r.outcomes.atoms && r.outcomes.dup).length,
    md: mdPath,
    html: htmlPath,
  }, null, 2))
}
