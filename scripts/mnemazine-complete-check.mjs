#!/usr/bin/env node
import { promises as fs } from 'node:fs'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'

const ROOT = process.env.MNEMAZINE_ROOT || path.resolve(process.cwd())
const VAULT = process.env.MNEMAZINE_VAULT || path.join(ROOT, 'vault')
const INBOX = process.env.MNEMAZINE_INBOX || path.join(ROOT, 'inbox')
const REPORTS = process.env.MNEMAZINE_REPORTS || path.join(ROOT, 'reports')
const STATE = process.env.MNEMAZINE_STATE || path.join(ROOT, '.mnemazine/state')
const argv = process.argv.slice(2)

function arg(name, fallback = '') {
  const hit = argv.find(a => a === `--${name}` || a.startsWith(`--${name}=`))
  if (!hit) return fallback
  return hit.includes('=') ? hit.split('=').slice(1).join('=') : argv[argv.indexOf(hit) + 1] || fallback
}

const NEEDS_UPDATE_MAX_DAYS = Number(arg('needs-update-max-days', process.env.MNEMAZINE_NEEDS_UPDATE_MAX_DAYS || '1'))
const STRICT_GRAPH = argv.includes('--strict-graph')
const REQUIRE_DEEP = argv.includes('--require-deep') || process.env.MNEMAZINE_REQUIRE_DEEP === '1'

function run(command, args) {
  return new Promise(resolve => {
    const child = spawn(command, args, { cwd: ROOT, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', chunk => { stdout += String(chunk) })
    child.stderr.on('data', chunk => { stderr += String(chunk) })
    child.on('close', code => resolve({ ok: code === 0, code: code ?? 1, stdout: stdout.trim(), stderr: stderr.trim() }))
    child.on('error', error => resolve({ ok: false, code: 1, stdout, stderr: `${stderr}\n${error.message}`.trim() }))
  })
}

async function newestFileMtime(dir, filter = () => true) {
  let newest = 0
  async function walk(folder) {
    for (const item of await fs.readdir(folder, { withFileTypes: true }).catch(() => [])) {
      if (item.name.startsWith('graphify-out')) continue
      const file = path.join(folder, item.name)
      if (item.isDirectory()) await walk(file)
      else if (item.isFile() && filter(file)) newest = Math.max(newest, (await fs.stat(file)).mtimeMs)
    }
  }
  await walk(dir)
  return newest
}

async function latestReport() {
  const reports = []
  for (const item of await fs.readdir(REPORTS, { withFileTypes: true }).catch(() => [])) {
    if (!item.isFile() || !item.name.endsWith('.html')) continue
    const file = path.join(REPORTS, item.name)
    reports.push({ file, mtimeMs: (await fs.stat(file)).mtimeMs })
  }
  return reports.sort((a, b) => b.mtimeMs - a.mtimeMs)[0]?.file || ''
}

async function activeInboxFiles() {
  return (await fs.readdir(INBOX, { withFileTypes: true }).catch(() => []))
    .filter(item => item.isFile() && !item.name.startsWith('.'))
    .map(item => item.name)
}

async function readJson(file, fallback = null) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')) } catch { return fallback }
}

function deepFailures(lastRun) {
  const failures = []
  if (!lastRun) return ['last run state missing']
  if (!lastRun.ok) failures.push(`last run failed: ${(lastRun.failures || [lastRun.failure || 'unknown']).join('; ')}`)
  if (!lastRun.deep) failures.push('last run was not deep')
  if (!lastRun.synthesize || lastRun.synthesize.skipped) {
    if (Number(lastRun.processed || 0) > 0) failures.push('deep synthesis did not run')
    return failures
  }
  if (lastRun.synthesize.degraded) failures.push('deep synthesis degraded to local template')
  if (Number(lastRun.processed || 0) > 0 && Number(lastRun.synthesize.atomized || 0) <= 0) failures.push('deep synthesis produced zero atoms')
  if (Number(lastRun.processed || 0) > 0 && lastRun.enrich_required && Number(lastRun.synthesize.enriched || 0) <= 0) failures.push('deep enrichment produced zero enriched clusters')
  return failures
}

async function main() {
  const failures = []
  const warnings = []
  const inboxFiles = await activeInboxFiles()
  if (inboxFiles.length) failures.push(`inbox not empty: ${inboxFiles.length}`)

  const quality = await run(process.execPath, ['scripts/mnemazine-vault-quality-gate.mjs'])
  if (!quality.ok) failures.push(`vault quality failed: ${quality.stderr || quality.stdout}`)

  const report = await latestReport()
  if (!report) failures.push('weekly report missing')
  else {
    const reportQuality = await run(process.execPath, ['scripts/mnemazine-report-quality-gate.mjs', '--report', report])
    if (!reportQuality.ok) failures.push(`report quality failed: ${reportQuality.stderr || reportQuality.stdout}`)
  }

  const newestNote = await newestFileMtime(VAULT, file => file.endsWith('.md'))
  const reportMtime = report ? (await fs.stat(report)).mtimeMs : 0
  if (newestNote && reportMtime && reportMtime < newestNote) failures.push('weekly report older than newest vault note')

  const brief = path.join(STATE, 'last-action-brief.md')
  if (!existsSync(brief)) failures.push('action brief missing')
  else if ((await fs.stat(brief)).mtimeMs < newestNote) failures.push('action brief older than newest vault note')

  const needsUpdate = path.join(VAULT, 'graphify-out', 'needs_update')
  if (existsSync(needsUpdate)) {
    const ageDays = (Date.now() - (await fs.stat(needsUpdate)).mtimeMs) / 86400000
    const msg = `semantic graph pending (${ageDays.toFixed(2)} days)`
    if (STRICT_GRAPH || ageDays > NEEDS_UPDATE_MAX_DAYS) failures.push(msg)
    else warnings.push(msg)
  }

  const lastRunFile = path.join(STATE, 'last-run.json')
  const lastRun = await readJson(lastRunFile)
  if (REQUIRE_DEEP) {
    for (const failure of deepFailures(lastRun)) failures.push(failure)
  }

  const result = {
    ok: failures.length === 0,
    failures,
    warnings,
    inbox: inboxFiles.length,
    deep_required: REQUIRE_DEEP,
    last_run: lastRun ? {
      ok: lastRun.ok,
      deep: lastRun.deep,
      processed: lastRun.processed,
      atomized: lastRun.synthesize?.atomized ?? null,
      enriched: lastRun.synthesize?.enriched ?? null,
      finished_at: lastRun.finished_at || null
    } : null,
    report: report ? path.relative(ROOT, report) : null,
    brief: existsSync(brief) ? path.relative(ROOT, brief) : null
  }
  console.log(JSON.stringify(result, null, 2))
  if (!result.ok) process.exit(1)
}

main().catch(error => {
  console.error(error.message || error)
  process.exit(1)
})
