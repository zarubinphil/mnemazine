#!/usr/bin/env node
// Hybrid verification for synthesized notes (README:160 "verified, assumed, or
// still unknown"). Default = local, zero-network structural gate. Deep = opt-in
// network: HEAD reachability + a codex web cross-check of the claim.
// ponytail: local gate is deliberately structural (no HEAD by default) so the
// conservative pipeline never reaches the network. Reachability+LLM only on --deep.
import { llmAvailable, llmJson, fenceUntrusted } from './mnemazine-llm.mjs'

// Local gate: a source URL present means the claim is at least anchored
// ("assumed"); none means we cannot back it at all ("unknown"). Never claims
// "verified" — only a real source check earns that.
export function verifyLocal(urls = []) {
  const has = (urls || []).filter(Boolean).length > 0
  return { status: has ? 'assumed' : 'unknown', checked: [], note: has ? 'source url present, not fetched' : 'no source url' }
}

const VERIFY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['status', 'evidence', 'checked'],
  properties: {
    status: { type: 'string', enum: ['verified', 'assumed', 'unknown'] },
    evidence: { type: 'string' },
    checked: { type: 'array', items: { type: 'string' } }
  }
}

async function fetchWithTimeout(url, opts, timeoutMs) {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    return await fetch(url, { ...opts, redirect: 'follow', signal: ctrl.signal }).catch(() => null)
  } finally {
    clearTimeout(t)
  }
}

async function headOk(url, timeoutMs) {
  let res = await fetchWithTimeout(url, { method: 'HEAD' }, timeoutMs)
  // Some servers reject HEAD — fall back to a ranged GET with a FRESH timeout
  // (a shared aborted controller would otherwise kill the fallback instantly).
  if (!res || !res.ok) {
    res = await fetchWithTimeout(url, { method: 'GET', headers: { Range: 'bytes=0-0' } }, timeoutMs)
  }
  return !!res && res.ok
}

// Deep gate: confirm reachability, then ask codex (with its own web search) to
// judge whether the listed sources actually support the claim. Degrades to the
// local verdict if codex is unavailable or errors.
export async function verifyDeep(claim, urls = [], options = {}) {
  const timeoutMs = options.timeoutMs || 8000
  const live = []
  for (const url of (urls || []).filter(Boolean)) {
    if (await headOk(url, timeoutMs)) live.push(url)
  }
  if (!llmAvailable(options.provider)) {
    const local = verifyLocal(live)
    return { ...local, checked: live, note: `llm unavailable; reachable=${live.length}` }
  }
  try {
    const prompt = `Verify whether the SOURCES below support the CLAIM. Use web search to check. Return status: "verified" only if a source clearly supports the claim, "assumed" if a source is relevant but does not clearly confirm it, "unknown" if no source supports it. Be strict.

${fenceUntrusted('CLAIM', String(claim).slice(0, 4000))}

SOURCES:
${live.length ? live.join('\n') : '(none reachable)'}`
    const res = await llmJson(prompt, VERIFY_SCHEMA, { timeoutMs: options.llmTimeoutMs, provider: options.provider, tools: ['WebSearch', 'WebFetch'] })
    const status = ['verified', 'assumed', 'unknown'].includes(res?.status) ? res.status : 'unknown'
    return { status, checked: res?.checked?.length ? res.checked : live, evidence: res?.evidence || '', note: 'llm cross-check' }
  } catch (err) {
    const local = verifyLocal(live)
    return { ...local, checked: live, note: `deep verify failed: ${err.message}` }
  }
}

// Internal: exercise the codex cross-check path against MNEMAZINE_CODEX_BIN
// (used by --selftest with a stub bin; no real network/LLM). No reachable URL,
// so headOk yields [] and the verdict comes purely from the stubbed codex JSON.
if (process.argv.includes('--deep-once')) {
  const verdict = await verifyDeep('stub claim', [], { codexTimeoutMs: 10000 })
  console.log(JSON.stringify(verdict))
  process.exit(0)
}

// Self-check: run `node scripts/mnemazine-verify.mjs --selftest`
if (process.argv.includes('--selftest')) {
  const a = verifyLocal(['https://x.test'])
  const b = verifyLocal([])
  if (a.status !== 'assumed') throw new Error('expected assumed for url present')
  if (b.status !== 'unknown') throw new Error('expected unknown for no url')

  // Deep path with a stub codex bin (provider=codex): confirm llmJson round-trips
  // and the status enum is honoured end-to-end. Claude backend shares the same
  // contract; live Claude needs one real run to confirm (unproven in CI).
  const { promises: fsp } = await import('node:fs')
  const os = await import('node:os')
  const path = await import('node:path')
  const { spawnSync } = await import('node:child_process')
  const { fileURLToPath } = await import('node:url')
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'mnemazine-verify-selftest-'))
  const bin = path.join(dir, 'fakecodex')
  await fsp.writeFile(bin, `#!/usr/bin/env bash
out=""; while [ $# -gt 0 ]; do [ "$1" = "-o" ] && { out="$2"; shift; }; shift; done
cat >/dev/null
printf '%s' '{"status":"verified","evidence":"stub confirms","checked":["https://e.test"]}' > "$out"
`, { mode: 0o755 })
  const res = spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--deep-once'], {
    env: { ...process.env, MNEMAZINE_LLM: 'codex', MNEMAZINE_CODEX_BIN: bin }, encoding: 'utf8'
  })
  await fsp.rm(dir, { recursive: true, force: true })
  if (res.status !== 0) throw new Error(`deep-once failed: ${res.stderr}`)
  const verdict = JSON.parse(res.stdout)
  if (verdict.status !== 'verified') throw new Error(`expected verified from stub codex, got ${verdict.status}`)

  console.log('verify selftest ok')
}
