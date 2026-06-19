#!/usr/bin/env node
// Mnemazine Telegram Mini App backend. Localhost HTTP API behind nginx TLS.
// Endpoints (all require valid Telegram WebApp initData for an allowed user):
//   GET  /api/status  -> { count, recent:[{name,at}], lastRun }
//   POST /api/send    {text} -> writes a note into the inbox
//   POST /api/run     -> touches .run-now flag; Mac poller picks it up
// Native http + crypto only, zero deps.
//
// Env: TELEGRAM_BOT_TOKEN (required), MNEMAZINE_INBOX, ALLOWED_CHAT_IDS, PORT (8787)

import http from 'node:http'
import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'

const SELFTEST = process.argv.includes('--selftest')
const TOKEN = process.env.TELEGRAM_BOT_TOKEN
if (!TOKEN && !SELFTEST) { console.error('FATAL: TELEGRAM_BOT_TOKEN not set'); process.exit(1) }
const INBOX = path.resolve(process.env.MNEMAZINE_INBOX || path.join(process.cwd(), 'inbox'))
const RUN_FLAG = path.join(INBOX, '.run-now')
const RUN_MARKER = path.join(INBOX, '.last-run')
const PORT = Number(process.env.PORT || 8787)
const ALLOWED = (process.env.ALLOWED_CHAT_IDS || '').split(',').map(s => s.trim()).filter(Boolean)

// Verify Telegram WebApp initData. Returns the user object or null.
// https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
function verifyInitData(initData, token) {
  const params = new URLSearchParams(initData)
  const hash = params.get('hash')
  if (!hash) return null
  params.delete('hash')
  const dataCheckString = [...params.entries()]
    .map(([k, v]) => `${k}=${v}`)
    .sort()
    .join('\n')
  const secret = crypto.createHmac('sha256', 'WebAppData').update(token).digest()
  const calc = crypto.createHmac('sha256', secret).update(dataCheckString).digest('hex')
  // timing-safe compare
  if (calc.length !== hash.length || !crypto.timingSafeEqual(Buffer.from(calc), Buffer.from(hash))) return null
  try { return JSON.parse(params.get('user') || 'null') } catch { return null }
}

const json = (res, code, obj) => {
  res.writeHead(code, { 'content-type': 'application/json' })
  res.end(JSON.stringify(obj))
}

async function readBody(req) {
  const chunks = []
  for await (const c of req) chunks.push(c)
  return Buffer.concat(chunks).toString('utf8')
}

async function status() {
  const names = (await fs.readdir(INBOX).catch(() => [])).filter(n => !n.startsWith('.'))
  const recent = []
  for (const n of names.slice(-10).reverse()) {
    const st = await fs.stat(path.join(INBOX, n)).catch(() => null)
    if (st) recent.push({ name: n, at: st.mtime.toISOString() })
  }
  const lastRun = await fs.readFile(RUN_MARKER, 'utf8').catch(() => null)
  return { count: names.length, recent, lastRun: lastRun?.trim() || null }
}

async function send(text) {
  await fs.mkdir(INBOX, { recursive: true })
  const stamp = new Date().toISOString()
  const day = stamp.slice(0, 10)
  const body = ['---', 'source: telegram-webapp', `date: ${stamp}`, '---', '', text, ''].join('\n')
  const name = `tg_${day}_webapp_${Date.now()}.md`
  await fs.writeFile(path.join(INBOX, name), body, 'utf8')
  return name
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost')
    if (!url.pathname.startsWith('/api/')) return json(res, 404, { error: 'not found' })

    const initData = req.headers['x-telegram-initdata'] || ''
    const user = verifyInitData(String(initData), TOKEN)
    if (!user) return json(res, 401, { error: 'bad initData' })
    if (ALLOWED.length && !ALLOWED.includes(String(user.id))) return json(res, 403, { error: 'forbidden' })

    if (req.method === 'GET' && url.pathname === '/api/status') return json(res, 200, await status())
    if (req.method === 'POST' && url.pathname === '/api/send') {
      const { text } = JSON.parse(await readBody(req) || '{}')
      if (!text || !text.trim()) return json(res, 400, { error: 'empty text' })
      return json(res, 200, { ok: true, saved: await send(text.trim()) })
    }
    if (req.method === 'POST' && url.pathname === '/api/run') {
      await fs.mkdir(INBOX, { recursive: true })
      await fs.writeFile(RUN_FLAG, new Date().toISOString(), 'utf8')
      return json(res, 200, { ok: true, queued: true })
    }
    return json(res, 404, { error: 'not found' })
  } catch (e) {
    return json(res, 500, { error: e.message })
  }
})

async function selftest() {
  const assert = (c, m) => { if (!c) throw new Error(`selftest: ${m}`) }
  // build a valid initData and verify round-trips; tampered fails.
  const tok = 'test:token'
  const user = JSON.stringify({ id: 1, first_name: 'F' })
  const p = new URLSearchParams({ auth_date: '1', user })
  const dcs = [...p.entries()].map(([k, v]) => `${k}=${v}`).sort().join('\n')
  const secret = crypto.createHmac('sha256', 'WebAppData').update(tok).digest()
  const hash = crypto.createHmac('sha256', secret).update(dcs).digest('hex')
  p.set('hash', hash)
  const ok = verifyInitData(p.toString(), tok)
  assert(ok && ok.id === 1, 'valid initData accepted')
  assert(verifyInitData(p.toString(), 'wrong:token') === null, 'wrong token rejected')
  const bad = new URLSearchParams(p); bad.set('auth_date', '2')
  assert(verifyInitData(bad.toString(), tok) === null, 'tampered payload rejected')
  assert(verifyInitData('', tok) === null, 'empty rejected')
  console.log('selftest ok')
}

if (SELFTEST) selftest().catch(e => { console.error(e.message); process.exit(1) })
else server.listen(PORT, '127.0.0.1', () => console.log(`Mnemazine webapp API on 127.0.0.1:${PORT} inbox=${INBOX} allow=${ALLOWED.join(',') || 'ANY'}`))
