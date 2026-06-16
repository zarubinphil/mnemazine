#!/usr/bin/env node
import { promises as fs } from 'node:fs'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { spawn } from 'node:child_process'

const argv = process.argv.slice(2)

function arg(name, fallback = '') {
  const hit = argv.find(a => a === `--${name}` || a.startsWith(`--${name}=`))
  if (!hit) return fallback
  return hit.includes('=') ? hit.split('=').slice(1).join('=') : argv[argv.indexOf(hit) + 1] || fallback
}

function hasFlag(name) {
  return argv.includes(`--${name}`)
}

const ROOT = path.resolve(process.cwd())
const CONFIG_PATH = path.join(ROOT, 'config', 'graphify-refresh.json')
const CONFIG = existsSync(CONFIG_PATH)
  ? JSON.parse(readFileSync(CONFIG_PATH, 'utf8'))
  : {}
const VAULT = path.resolve(arg('vault', process.env.MNEMAZINE_VAULT || path.join(ROOT, 'vault')))
const MODE = arg('mode', 'auto')
const BACKEND = arg('backend', process.env.MNEMAZINE_GRAPHIFY_BACKEND || CONFIG.backend || 'ollama')
const MODEL = arg('model', process.env.MNEMAZINE_GRAPHIFY_MODEL || CONFIG.model || 'qwen:32b')
const CONFIG_MODELS = Array.isArray(CONFIG.models) ? CONFIG.models.join(',') : ''
const MODEL_LADDER = (arg('models', process.env.MNEMAZINE_GRAPHIFY_MODELS || CONFIG_MODELS || `${MODEL},gemma2:9b,qwen2.5-coder:7b`)
  .split(',')
  .map(item => item.trim())
  .filter(Boolean))
const TIMEOUT_MS = Number(arg('timeout-seconds', String(CONFIG.timeout_seconds || '900'))) * 1000
const SMOKE_TIMEOUT_MS = Number(arg('smoke-timeout-seconds', String(CONFIG.smoke_timeout_seconds || '120'))) * 1000
const SHRINK_THRESHOLD = Number(arg('shrink-threshold', String(CONFIG.shrink_threshold || '0.85')))
const JSON_OUT = hasFlag('json')
const GRAPHIFY_OUT = path.join(VAULT, 'graphify-out')
const GRAPH_PATH = path.join(GRAPHIFY_OUT, 'graph.json')
const REPORT_PATH = path.join(GRAPHIFY_OUT, 'GRAPH_REPORT.md')
const ANALYSIS_PATH = path.join(GRAPHIFY_OUT, '.graphify_analysis.json')
const MANIFEST_PATH = path.join(GRAPHIFY_OUT, 'manifest.json')
const NEEDS_UPDATE_PATH = path.join(GRAPHIFY_OUT, 'needs_update')
const EXCLUDED_DIRS = new Set(['.git', '.obsidian'])

function normalizeOllamaBaseUrl(value) {
  const raw = String(value || process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434').trim().replace(/\/+$/, '')
  return raw.endsWith('/v1') ? raw : `${raw}/v1`
}

const OLLAMA_BASE_URL = normalizeOllamaBaseUrl(arg('ollama-url', ''))

function rel(file) {
  return path.relative(VAULT, file) || '.'
}

async function walk(dir) {
  const out = []
  for (const item of await fs.readdir(dir, { withFileTypes: true }).catch(() => [])) {
    if (EXCLUDED_DIRS.has(item.name) || item.name.startsWith('graphify-out')) continue
    const p = path.join(dir, item.name)
    if (item.isDirectory()) out.push(...await walk(p))
    else if (item.isFile()) out.push(p)
  }
  return out
}

function isNonCodeFile(file) {
  const ext = path.extname(file).toLowerCase()
  return ['.md', '.txt', '.pdf', '.png', '.jpg', '.jpeg', '.webp', '.heic', '.tiff', '.gif', '.svg'].includes(ext)
}

async function newestNonCodeMtimeMs() {
  let newest = 0
  for (const file of await walk(VAULT)) {
    if (!isNonCodeFile(file)) continue
    const stat = await fs.stat(file).catch(() => null)
    if (stat) newest = Math.max(newest, stat.mtimeMs)
  }
  return newest
}

async function fileMtimeMs(file) {
  const stat = await fs.stat(file).catch(() => null)
  return stat ? stat.mtimeMs : 0
}

async function graphSummary(graphPath) {
  if (!existsSync(graphPath)) return { exists: false, nodes: 0, edges: 0, communities: 0, mtimeMs: 0 }
  const raw = JSON.parse(await fs.readFile(graphPath, 'utf8'))
  const nodes = Array.isArray(raw.nodes) ? raw.nodes.length : 0
  const links = Array.isArray(raw.links) ? raw.links : Array.isArray(raw.edges) ? raw.edges : []
  const communities = new Set((raw.nodes || []).map(node => node.community).filter(v => v !== undefined && v !== null)).size
  return {
    exists: true,
    nodes,
    edges: links.length,
    communities,
    mtimeMs: await fileMtimeMs(graphPath)
  }
}

function truncate(text, max = 500) {
  const clean = String(text || '').trim()
  return clean.length > max ? `${clean.slice(0, max)}...` : clean
}

function unique(items) {
  return [...new Set(items.filter(Boolean))]
}

function stripCodeFence(text) {
  const value = String(text || '').trim()
  const match = value.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)
  return match ? match[1].trim() : value
}

function runCommand(cmd, args, { env = {}, cwd = ROOT, timeoutMs = TIMEOUT_MS } = {}) {
  return new Promise(resolve => {
    const child = spawn(cmd, args, {
      cwd,
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe']
    })
    let stdout = ''
    let stderr = ''
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      child.kill('SIGTERM')
      setTimeout(() => child.kill('SIGKILL'), 5000).unref()
    }, timeoutMs)
    child.stdout.on('data', chunk => { stdout += String(chunk) })
    child.stderr.on('data', chunk => { stderr += String(chunk) })
    child.on('close', code => {
      clearTimeout(timer)
      resolve({ code: code ?? 1, stdout, stderr, timedOut })
    })
    child.on('error', error => {
      clearTimeout(timer)
      resolve({ code: 1, stdout, stderr: `${stderr}\n${error.message}`, timedOut })
    })
  })
}

async function ensureGraphifyOut() {
  await fs.mkdir(GRAPHIFY_OUT, { recursive: true })
}

async function removeIfExists(target) {
  await fs.rm(target, { recursive: true, force: true }).catch(() => {})
}

async function copyDir(from, to) {
  await removeIfExists(to)
  await fs.cp(from, to, { recursive: true })
}

async function restoreBackup(backupDir) {
  if (!existsSync(backupDir)) return
  await removeIfExists(GRAPHIFY_OUT)
  await copyDir(backupDir, GRAPHIFY_OUT)
}

async function writeNeedsUpdate() {
  await ensureGraphifyOut()
  await fs.writeFile(NEEDS_UPDATE_PATH, '1', 'utf8')
}

async function clearNeedsUpdate() {
  await fs.rm(NEEDS_UPDATE_PATH, { force: true }).catch(() => {})
}

async function ollamaSmoke(model) {
  const modelsRes = await fetch(`${OLLAMA_BASE_URL}/models`).catch(err => ({ ok: false, statusText: err.message }))
  if (!modelsRes.ok) {
    return { ok: false, step: 'models', reason: `${modelsRes.status || 'fetch'} ${modelsRes.statusText || 'failed'}` }
  }
  const modelsPayload = await modelsRes.json().catch(() => ({}))
  const names = Array.isArray(modelsPayload.data) ? modelsPayload.data.map(item => item.id || item.name).filter(Boolean) : []
  if (names.length && !names.includes(model)) {
    return { ok: false, step: 'models', reason: `model ${model} not found`, available_models: names.slice(0, 20) }
  }
  const body = {
    model,
    messages: [{ role: 'user', content: 'Return only valid JSON: {"ok":true}' }],
    max_tokens: 20,
    temperature: 0,
    stream: false
  }
  const chatRes = await fetch(`${OLLAMA_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: 'Bearer local'
    },
    body: JSON.stringify(body)
  }).catch(err => ({ ok: false, statusText: err.message }))
  if (!chatRes.ok) {
    return { ok: false, step: 'chat', reason: `${chatRes.status || 'fetch'} ${chatRes.statusText || 'failed'}` }
  }
  const chat = await chatRes.json().catch(() => null)
  const content = stripCodeFence(chat?.choices?.[0]?.message?.content?.trim() || '')
  try {
    const parsed = JSON.parse(content)
    if (parsed?.ok === true) return { ok: true, step: 'chat' }
    return { ok: false, step: 'chat', reason: 'response parsed but missing ok=true', content: truncate(content, 120) }
  } catch {
    return { ok: false, step: 'chat', reason: 'response not valid JSON', content: truncate(content, 120) }
  }
}

async function graphifyMiniSmoke(model) {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'mnemazine-graphify-smoke-'))
  const notePath = path.join(tempRoot, 'smoke.md')
  const smokeNote = `# Graphify Smoke

## What This Is

Local graphify smoke note for semantic extraction.

## Why It Matters

Automation must reject models that break graphify JSON extraction.

## How To Use

Return stable JSON graph fragments for document notes.

## Source

- local smoke fixture

## Verification

- generated for automation
`
  await fs.writeFile(notePath, smokeNote, 'utf8')
  const env = {
    OLLAMA_BASE_URL,
    OLLAMA_API_KEY: process.env.OLLAMA_API_KEY || 'local'
  }
  const extract = await runCommand('graphify', ['extract', tempRoot, '--backend', 'ollama', '--model', model], {
    cwd: ROOT,
    env,
    timeoutMs: SMOKE_TIMEOUT_MS
  })
  const graphPath = path.join(tempRoot, 'graphify-out', 'graph.json')
  const summary = await graphSummary(graphPath).catch(() => ({ exists: false, nodes: 0, edges: 0, communities: 0, mtimeMs: 0 }))
  const invalidJson = /invalid JSON/i.test(`${extract.stdout}\n${extract.stderr}`)
  await removeIfExists(tempRoot)
  if (extract.code !== 0 || extract.timedOut || invalidJson || !summary.exists || summary.nodes === 0) {
    return {
      ok: false,
      reason: extract.timedOut ? 'mini_extract_timeout' : invalidJson ? 'mini_extract_invalid_json' : 'mini_extract_failed',
      extract_code: extract.code,
      extract_timed_out: extract.timedOut,
      stdout_tail: truncate(extract.stdout, 600),
      stderr_tail: truncate(extract.stderr, 600),
      graph: summary
    }
  }
  return {
    ok: true,
    graph: summary,
    stdout_tail: truncate(extract.stdout, 600),
    stderr_tail: truncate(extract.stderr, 600)
  }
}

async function pickSemanticModel() {
  const attempts = []
  for (const model of unique(MODEL_LADDER)) {
    const chat = await ollamaSmoke(model)
    if (!chat.ok) {
      attempts.push({ model, chat, mini: null, ok: false })
      continue
    }
    const mini = await graphifyMiniSmoke(model)
    attempts.push({ model, chat, mini, ok: mini.ok })
    if (mini.ok) return { ok: true, model, attempts }
  }
  return { ok: false, attempts }
}

async function refreshCodeGraph() {
  const result = await runCommand('graphify', ['update', VAULT], { cwd: ROOT })
  return {
    ok: result.code === 0 && !result.timedOut,
    code: result.code,
    timedOut: result.timedOut,
    stdout_tail: truncate(result.stdout, 1200),
    stderr_tail: truncate(result.stderr, 1200)
  }
}

async function realignReport() {
  const result = await runCommand('graphify', ['cluster-only', VAULT, '--graph', GRAPH_PATH, '--no-viz'], { cwd: ROOT })
  return {
    ok: result.code === 0 && !result.timedOut,
    code: result.code,
    timedOut: result.timedOut,
    stdout_tail: truncate(result.stdout, 1200),
    stderr_tail: truncate(result.stderr, 1200)
  }
}

async function semanticRefresh({ baseline }) {
  const backupDir = path.join(VAULT, `graphify-out-backup-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}`)
  await copyDir(GRAPHIFY_OUT, backupDir)

  if (BACKEND !== 'ollama') {
    await writeNeedsUpdate()
    return {
      ok: false,
      status: 'unsupported_backend',
      backup_dir: backupDir,
      reason: `semantic helper currently automates ollama only, got ${BACKEND}`
    }
  }

  const selected = await pickSemanticModel()
  if (!selected.ok) {
    await writeNeedsUpdate()
    return {
      ok: false,
      status: 'smoke_failed',
      backup_dir: backupDir,
      selected
    }
  }
  const chosenModel = selected.model

  const manifestBak = existsSync(MANIFEST_PATH) ? `${MANIFEST_PATH}.bak` : null
  if (manifestBak) {
    await removeIfExists(manifestBak)
    await fs.rename(MANIFEST_PATH, manifestBak)
  }

  const env = {
    OLLAMA_BASE_URL,
    OLLAMA_API_KEY: process.env.OLLAMA_API_KEY || 'local'
  }
  const extract = await runCommand('graphify', ['extract', VAULT, '--backend', BACKEND, '--model', chosenModel], {
    cwd: ROOT,
    env
  })

  const summary = await graphSummary(GRAPH_PATH).catch(() => ({ exists: false, nodes: 0, edges: 0, communities: 0, mtimeMs: 0 }))
  const reportRefresh = existsSync(GRAPH_PATH) ? await realignReport() : { ok: false, code: 1, timedOut: false, stdout_tail: '', stderr_tail: 'graph missing after extract' }

  const invalidJson = /invalid JSON/i.test(`${extract.stdout}\n${extract.stderr}`)
  const severeShrink = baseline.nodes > 0 && summary.nodes < Math.floor(baseline.nodes * SHRINK_THRESHOLD)
  const success = extract.code === 0 &&
    !extract.timedOut &&
    summary.exists &&
    summary.nodes > 0 &&
    summary.edges > 0 &&
    !invalidJson &&
    !severeShrink &&
    reportRefresh.ok

  if (!success) {
    await restoreBackup(backupDir)
    if (manifestBak && existsSync(manifestBak) && !existsSync(MANIFEST_PATH)) {
      await fs.rename(manifestBak, MANIFEST_PATH).catch(() => {})
    }
    await writeNeedsUpdate()
    return {
      ok: false,
      status: extract.timedOut ? 'timeout' : invalidJson ? 'invalid_json' : severeShrink ? 'unsafe_shrink' : 'extract_failed',
      backup_dir: backupDir,
      selected,
      chosen_model: chosenModel,
      extract_code: extract.code,
      extract_timed_out: extract.timedOut,
      extract_stdout_tail: truncate(extract.stdout, 1800),
      extract_stderr_tail: truncate(extract.stderr, 1800),
      attempted_graph: summary,
      baseline,
      report_refresh: reportRefresh
    }
  }

  if (manifestBak) await removeIfExists(manifestBak)
  await clearNeedsUpdate()
  return {
    ok: true,
    status: 'success',
    backup_dir: backupDir,
    selected,
    chosen_model: chosenModel,
    graph: summary,
    extract_stdout_tail: truncate(extract.stdout, 1800),
    extract_stderr_tail: truncate(extract.stderr, 1800),
    report_refresh: reportRefresh
  }
}

async function main() {
  if (!['auto', 'code', 'semantic'].includes(MODE)) {
    console.error(`Unknown mode: ${MODE}. Use auto, code, or semantic.`)
    process.exit(1)
  }
  await ensureGraphifyOut()
  const initialBefore = await graphSummary(GRAPH_PATH)
  const semanticPendingBefore = existsSync(NEEDS_UPDATE_PATH) || (await newestNonCodeMtimeMs()) > initialBefore.mtimeMs
  const result = {
    ok: true,
    vault: VAULT,
    mode: MODE,
    config_path: existsSync(CONFIG_PATH) ? CONFIG_PATH : null,
    backend: BACKEND,
    model: MODEL,
    model_ladder: unique(MODEL_LADDER),
    ollama_base_url: BACKEND === 'ollama' ? OLLAMA_BASE_URL : null,
    before: initialBefore,
    code_refresh: null,
    semantic_refresh: null,
    after: null,
    semantic_pending_before: semanticPendingBefore,
    semantic_pending_after: null
  }

  result.code_refresh = await refreshCodeGraph()
  if (!result.code_refresh.ok) {
    await writeNeedsUpdate()
    result.ok = false
    result.after = await graphSummary(GRAPH_PATH)
    result.semantic_pending_after = true
    if (JSON_OUT) console.log(JSON.stringify(result, null, 2))
    else console.log(`Graphify code refresh failed. ${result.code_refresh.stderr_tail || result.code_refresh.stdout_tail}`)
    process.exit(1)
  }

  const afterCode = await graphSummary(GRAPH_PATH)
  const semanticPending = result.semantic_pending_before || existsSync(NEEDS_UPDATE_PATH) || (await newestNonCodeMtimeMs()) > afterCode.mtimeMs || MODE === 'semantic'

  if (MODE === 'code' || (MODE === 'auto' && !semanticPending)) {
    if (MODE !== 'semantic' && semanticPending) await writeNeedsUpdate()
    result.after = await graphSummary(GRAPH_PATH)
    result.semantic_pending_after = existsSync(NEEDS_UPDATE_PATH)
    result.ok = !result.semantic_pending_after
    if (JSON_OUT) console.log(JSON.stringify(result, null, 2))
    else console.log(result.semantic_pending_after
      ? `Code graph refreshed. Semantic refresh still pending for ${rel(NEEDS_UPDATE_PATH)}.`
      : `Graph refreshed. Nodes=${result.after.nodes} edges=${result.after.edges} communities=${result.after.communities}.`)
    process.exit(result.semantic_pending_after ? 2 : 0)
  }

  result.semantic_refresh = await semanticRefresh({ baseline: afterCode })
  result.after = await graphSummary(GRAPH_PATH)
  result.semantic_pending_after = existsSync(NEEDS_UPDATE_PATH)
  result.ok = result.semantic_refresh.ok && !result.semantic_pending_after

  if (JSON_OUT) console.log(JSON.stringify(result, null, 2))
  else if (result.ok) console.log(`Graph semantic refresh ok. Nodes=${result.after.nodes} edges=${result.after.edges} communities=${result.after.communities}.`)
  else console.log(`Graph semantic refresh pending. Reason=${result.semantic_refresh?.status || 'unknown'}. needs_update=1`)

  process.exit(result.ok ? 0 : 2)
}

main().catch(async error => {
  await writeNeedsUpdate().catch(() => {})
  const payload = {
    ok: false,
    vault: VAULT,
    error: error.message,
    mode: MODE
  }
  if (JSON_OUT) console.log(JSON.stringify(payload, null, 2))
  else console.error(error)
  process.exit(1)
})
