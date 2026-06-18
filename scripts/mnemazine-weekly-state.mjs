#!/usr/bin/env node
// Apply weekly-brief decisions to the vault (README:217-219):
//   read   -> keep in vault (no move, just recorded)
//   work   -> move note into the action backlog
//   forget -> move note into quarantine (NEVER deleted — recoverable)
// Reads weekly-state.json ({ "<vault-relative-path>": "read|work|forget" }),
// the exact shape the weekly HTML downloads.
// ponytail: move-not-delete is the whole safety contract here — forget quarantines.
import { promises as fs, existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const ROOT = process.env.MNEMAZINE_ROOT || path.resolve(process.cwd())
const argv = process.argv.slice(2)

function arg(name, fallback = '') {
  const hit = argv.find(a => a === `--${name}` || a.startsWith(`--${name}=`))
  if (!hit) return fallback
  return hit.includes('=') ? hit.split('=').slice(1).join('=') : argv[argv.indexOf(hit) + 1] || fallback
}

const VAULT = path.resolve(arg('vault', process.env.MNEMAZINE_VAULT || path.join(ROOT, 'vault')))
const STATE_DIR = arg('state-dir', process.env.MNEMAZINE_STATE || path.join(ROOT, '.mnemazine/state'))
const STATE_FILE = path.resolve(arg('state', path.join(STATE_DIR, 'weekly-state.json')))
const BACKLOG = path.resolve(arg('backlog', path.join(ROOT, '.mnemazine/backlog')))
const QUARANTINE = path.resolve(arg('quarantine', path.join(ROOT, '.mnemazine/quarantine')))
const DRY = argv.includes('--dry-run')

// Resolve a card id (vault-relative path) to an absolute path, refusing any
// path that escapes the vault (a malformed/hostile state file must not move
// arbitrary files).
function resolveInVault(id) {
  const abs = path.resolve(VAULT, id)
  const rel = path.relative(VAULT, abs)
  if (rel.startsWith('..') || path.isAbsolute(rel)) return null
  return abs
}

async function moveInto(dir, file) {
  const target = path.join(dir, path.basename(file))
  if (DRY) return target
  await fs.mkdir(dir, { recursive: true })
  await fs.rename(file, target)
  return target
}

// Self-check: `node scripts/mnemazine-weekly-state.mjs --selftest`. Verifies the
// two contracts that matter — forget quarantines (never deletes) and a path
// escaping the vault is refused.
async function selftest() {
  const os = await import('node:os')
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mnemazine-weekly-selftest-'))
  const vault = path.join(root, 'vault', '01 Concepts')
  await fs.mkdir(vault, { recursive: true })
  for (const n of ['a', 'b', 'c']) await fs.writeFile(path.join(vault, `${n}.md`), `# ${n}`, 'utf8')
  await fs.mkdir(path.join(root, '.mnemazine/state'), { recursive: true })
  await fs.writeFile(path.join(root, '.mnemazine/state/weekly-state.json'), JSON.stringify({
    '01 Concepts/a.md': 'read',
    '01 Concepts/b.md': 'work',
    '01 Concepts/c.md': 'forget',
    '../../etc/passwd': 'forget'
  }), 'utf8')
  const res = spawnRunner(root)
  const assert = (cond, msg) => { if (!cond) throw new Error(`selftest: ${msg}`) }
  assert(res.work === 1 && res.forget === 1 && res.read === 1, 'counts')
  assert(res.invalid === 1, 'path-escape must be refused')
  assert(existsSync(path.join(vault, 'a.md')), 'read keeps note in vault')
  assert(!existsSync(path.join(vault, 'b.md')) && existsSync(path.join(root, '.mnemazine/backlog/b.md')), 'work -> backlog')
  assert(!existsSync(path.join(vault, 'c.md')) && existsSync(path.join(root, '.mnemazine/quarantine/c.md')), 'forget -> quarantine (not deleted)')
  assert(!existsSync('/etc/passwd.moved'), 'no escape write')
  await fs.rm(root, { recursive: true, force: true })
  console.log('weekly-state selftest ok')
}

function spawnRunner(root) {
  const out = spawnSync(process.execPath, [fileURLToPath(import.meta.url)], {
    env: { ...process.env, MNEMAZINE_ROOT: root, MNEMAZINE_VAULT: path.join(root, 'vault') },
    encoding: 'utf8'
  })
  if (out.status !== 0) throw new Error(`runner failed: ${out.stderr}`)
  return JSON.parse(out.stdout)
}

async function main() {
  if (argv.includes('--selftest')) return selftest()
  const state = JSON.parse(await fs.readFile(STATE_FILE, 'utf8').catch(() => '{}'))
  const result = { read: 0, work: 0, forget: 0, missing: 0, invalid: 0 }
  for (const [id, action] of Object.entries(state)) {
    const file = resolveInVault(id)
    if (!file) { result.invalid += 1; continue }
    if (action === 'read') { result.read += 1; continue }
    if (!(await fs.access(file).then(() => true).catch(() => false))) { result.missing += 1; continue }
    if (action === 'work') { await moveInto(BACKLOG, file); result.work += 1 }
    else if (action === 'forget') { await moveInto(QUARANTINE, file); result.forget += 1 }
    else { result.invalid += 1 }
  }
  console.log(JSON.stringify({ ok: true, state: STATE_FILE, dry_run: DRY, ...result }, null, 2))
}

main().catch(err => { console.error(err.message || err); process.exit(1) })
