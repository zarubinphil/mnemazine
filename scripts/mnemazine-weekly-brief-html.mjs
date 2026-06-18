#!/usr/bin/env node
import { promises as fs } from 'node:fs'
import path from 'node:path'

const ROOT = process.env.MNEMAZINE_ROOT || path.resolve(process.cwd())
const VAULT = process.env.MNEMAZINE_VAULT || path.join(ROOT, 'vault')
const REPORTS = process.env.MNEMAZINE_REPORTS || path.join(ROOT, 'reports')
const STATE = process.env.MNEMAZINE_STATE || path.join(ROOT, '.mnemazine/state')

async function walk(dir) {
  const out = []
  for (const item of await fs.readdir(dir, { withFileTypes: true }).catch(() => [])) {
    const p = path.join(dir, item.name)
    if (item.isDirectory()) out.push(...await walk(p))
    else if (item.isFile() && p.endsWith('.md')) out.push(p)
  }
  return out
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
}

function titleOf(text, file) {
  return text.match(/^#\s+(.+)$/m)?.[1]?.trim() || path.basename(file, '.md')
}

function summaryOf(text) {
  const block = text.match(/## (?:What This Is|Что это|Суть)\s+([\s\S]*?)(\n## |$)/i)?.[1] || text
  return block.replace(/[#*_`>-]/g, '').replace(/\s+/g, ' ').trim().slice(0, 520)
}

await fs.mkdir(REPORTS, { recursive: true })
await fs.mkdir(STATE, { recursive: true })
const files = await walk(VAULT)
const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000
const cards = []
for (const file of files) {
  const stat = await fs.stat(file)
  if (stat.mtimeMs < weekAgo) continue
  const text = await fs.readFile(file, 'utf8')
  cards.push({ file: path.relative(VAULT, file), title: titleOf(text, file), summary: summaryOf(text) })
}

const html = `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Mnemazine Weekly</title>
<style>
:root{--blue:#0039a6;--red:#d52b1e;--ink:#111827;--muted:#667085;--line:#e5e7eb;--bg:#f8fafc}
*{box-sizing:border-box}body{margin:0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:var(--bg);color:var(--ink)}
header{min-height:48vh;padding:56px max(24px,8vw);background:linear-gradient(180deg,#fff 0 32%,var(--blue) 32% 66%,var(--red) 66%);color:white;display:flex;align-items:end}
.hero{max-width:980px;text-shadow:0 1px 24px rgba(0,0,0,.22)}h1{font-size:clamp(42px,7vw,92px);line-height:.95;margin:0 0 18px;letter-spacing:0}.lead{font-size:22px;max-width:760px;margin:0;color:#fff}
main{padding:34px max(18px,6vw) 70px}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:16px}
.card{background:#fff;border:1px solid var(--line);border-radius:8px;padding:20px;box-shadow:0 10px 28px rgba(17,24,39,.06)}
.path{font-size:12px;color:var(--muted);margin-bottom:10px}.card h2{font-size:20px;line-height:1.18;margin:0 0 10px}.card p{font-size:15px;line-height:1.55;color:#344054}
.actions{display:flex;gap:8px;margin-top:16px}.actions button{border:1px solid var(--line);background:#fff;border-radius:7px;padding:9px 10px;font-weight:650;cursor:pointer}.actions button[data-v=read]{color:var(--blue)}.actions button[data-v=work]{color:var(--red)}.actions button[data-v=forget]{color:#475467}
.actions button.active{background:var(--ink);color:white;border-color:var(--ink)}
</style>
</head>
<body>
<header><section class="hero"><h1>Mnemazine Weekly</h1><p class="lead">Сводка знаний за последние 7 дней: что появилось, что стоит взять в работу, что можно забыть.</p><button id="export" style="margin-top:18px;border:0;background:#fff;color:var(--blue);font-weight:700;border-radius:8px;padding:11px 16px;cursor:pointer">⬇ Скачать weekly-state.json</button></section></header>
<main><section class="grid">
${cards.map((c, i) => `<article class="card" data-id="${esc(c.file)}"><div class="path">${esc(c.file)}</div><h2>${esc(c.title)}</h2><p>${esc(c.summary)}</p><div class="actions"><button data-v="read">Прочитал</button><button data-v="work">В работу</button><button data-v="forget">Забыть</button></div></article>`).join('\n') || '<article class="card"><h2>За неделю новых заметок нет</h2><p>Положите материалы в inbox и запустите Mnemazine.</p></article>'}
</section></main>
<script>
const KEY='mnemazine-weekly-state';
const state=JSON.parse(localStorage.getItem(KEY)||'{}');
document.querySelectorAll('.card').forEach(card=>{
  const id=card.dataset.id;
  card.querySelectorAll('button').forEach(btn=>{
    if(state[id]===btn.dataset.v) btn.classList.add('active');
    btn.onclick=()=>{state[id]=btn.dataset.v;localStorage.setItem(KEY,JSON.stringify(state));card.querySelectorAll('button').forEach(b=>b.classList.remove('active'));btn.classList.add('active')}
  })
})
// Export local state to a file the node CLI applies to the vault:
//   node scripts/mnemazine-weekly-state.mjs --state ~/Downloads/weekly-state.json
document.getElementById('export').onclick=()=>{
  const blob=new Blob([JSON.stringify(state,null,2)],{type:'application/json'});
  const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='weekly-state.json';a.click();URL.revokeObjectURL(a.href);
};
</script>
</body></html>`

const out = path.join(REPORTS, `${new Date().toISOString().slice(0, 10)}-weekly-mnemazine.html`)
await fs.writeFile(out, html, 'utf8')
await fs.writeFile(path.join(STATE, 'weekly-state.example.json'), JSON.stringify({ note: 'Browser localStorage stores per-card state by default.' }, null, 2), 'utf8')
console.log(out)
