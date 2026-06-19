#!/usr/bin/env node
import { promises as fs } from 'node:fs'
import { existsSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { spawn } from 'node:child_process'

const ROOT = path.resolve(process.cwd())

function run(command, args, options = {}) {
  return new Promise(resolve => {
    const child = spawn(command, args, {
      cwd: options.cwd || ROOT,
      env: { ...process.env, ...(options.env || {}) },
      stdio: ['ignore', 'pipe', 'pipe']
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', chunk => { stdout += String(chunk) })
    child.stderr.on('data', chunk => { stderr += String(chunk) })
    child.on('close', code => resolve({ code: code ?? 1, stdout, stderr }))
    child.on('error', error => resolve({ code: 1, stdout, stderr: `${stderr}\n${error.message}` }))
  })
}

async function must(label, command, args, options = {}) {
  const result = await run(command, args, options)
  if (result.code !== 0) {
    throw new Error(`${label} failed\n$ ${command} ${args.join(' ')}\n${result.stdout}\n${result.stderr}`.trim())
  }
  return result
}

async function readJson(file) {
  return JSON.parse(await fs.readFile(file, 'utf8'))
}

async function listFiles(dir) {
  const out = []
  for (const entry of await fs.readdir(dir, { withFileTypes: true }).catch(() => [])) {
    const file = path.join(dir, entry.name)
    if (entry.isDirectory()) out.push(...await listFiles(file))
    else out.push(file)
  }
  return out
}

async function checkSyntax() {
  const scripts = [
    'scripts/mnemazine-run.mjs',
    'scripts/mnemazine-vault-quality-gate.mjs',
    'scripts/mnemazine-refresh-graphify.mjs',
    'scripts/mnemazine-refresh-graphify-smoke.mjs',
    'scripts/mnemazine-graph-utils.mjs',
    'scripts/mnemazine-repair-graphify-graph.mjs',
    'scripts/mnemazine-semantic-shards.mjs',
    'scripts/mnemazine-semantic-batches.mjs',
    'scripts/mnemazine-synthesize.mjs',
    'scripts/mnemazine-kb-search.mjs',
    'scripts/mnemazine-llm.mjs',
    'scripts/mnemazine-codex.mjs',
    'scripts/mnemazine-verify.mjs',
    'scripts/mnemazine-weekly-brief-html.mjs',
    'scripts/mnemazine-weekly-state.mjs',
    'scripts/mnemazine-digest.mjs',
    'scripts/mnemazine-report-quality-gate.mjs',
    'scripts/mnemazine-complete-check.mjs',
    'scripts/mnemazine-release-check.mjs'
  ]
  for (const script of scripts) {
    if (existsSync(path.join(ROOT, script))) await must(`syntax:${script}`, process.execPath, ['--check', script])
  }
  if (existsSync(path.join(ROOT, 'scripts/graphify-extract-limited.py'))) {
    await must('syntax:scripts/graphify-extract-limited.py', 'python3', ['-m', 'py_compile', 'scripts/graphify-extract-limited.py'])
  }
}

async function demoSmoke() {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'mnemazine-release-'))
  const inbox = path.join(temp, 'inbox')
  const vault = path.join(temp, 'vault')
  const scripts = path.join(temp, 'scripts')
  await fs.mkdir(inbox, { recursive: true })
  await fs.mkdir(vault, { recursive: true })
  await fs.mkdir(scripts, { recursive: true })
  await fs.copyFile(path.join(ROOT, 'demo/inbox/example-guide.md'), path.join(inbox, 'example-guide.md'))
  await fs.writeFile(path.join(inbox, 'empty-source.bin'), '')
  await fs.copyFile(path.join(ROOT, 'scripts/mnemazine-vault-quality-gate.mjs'), path.join(scripts, 'mnemazine-vault-quality-gate.mjs'))
  await fs.copyFile(path.join(ROOT, 'scripts/mnemazine-synthesize.mjs'), path.join(scripts, 'mnemazine-synthesize.mjs'))
  await fs.copyFile(path.join(ROOT, 'scripts/mnemazine-llm.mjs'), path.join(scripts, 'mnemazine-llm.mjs'))
  await fs.copyFile(path.join(ROOT, 'scripts/mnemazine-codex.mjs'), path.join(scripts, 'mnemazine-codex.mjs'))
  await fs.copyFile(path.join(ROOT, 'scripts/mnemazine-verify.mjs'), path.join(scripts, 'mnemazine-verify.mjs'))

  await must('demo intake smoke', process.execPath, ['scripts/mnemazine-run.mjs'], {
    env: {
      MNEMAZINE_ROOT: temp,
      MNEMAZINE_INBOX: inbox,
      MNEMAZINE_VAULT: vault
    }
  })

  const inboxFiles = await fs.readdir(inbox)
  if (inboxFiles.length !== 0) throw new Error(`demo smoke failed: inbox not empty (${inboxFiles.join(', ')})`)

  const notes = (await listFiles(vault))
    .filter(file => file.endsWith('.md'))
    .filter(file => !file.split(path.sep).includes('graphify-out'))
  if (notes.length < 1) throw new Error(`demo smoke failed: expected synthesized notes, got ${notes.length}`)
  const forbidden = [/intake-draft/i, /draft-local/i, /\btemp_image/i, /\bIMG_\d+/, /\.(WEBP|PNG|JPE?G|HEIC|TIFF)\b/, /status:\s*"candidate"/i, /local extraction only/i]
  for (const noteFile of notes) {
    const note = await fs.readFile(noteFile, 'utf8')
    const hit = forbidden.find(re => re.test(note))
    if (hit) throw new Error(`demo smoke failed: raw marker in ${path.basename(noteFile)} (${hit})`)
    if (!/type:\s*"knowledge-note"/.test(note)) throw new Error(`demo smoke failed: ${path.basename(noteFile)} is not knowledge-note`)
    if (!/source_ref:\s*"session:/.test(note) || !/local-media:/.test(note)) throw new Error(`demo smoke failed: ${path.basename(noteFile)} synthesis provenance missing`)
  }

  const archived = await listFiles(path.join(temp, '.mnemazine/archive'))
  if (archived.length !== 2) throw new Error(`demo smoke failed: expected 2 archived sources, got ${archived.length}`)

  const extractRecords = (await listFiles(path.join(temp, '.mnemazine/cache/extracted'))).filter(file => file.endsWith('.json'))
  if (extractRecords.length !== 2) throw new Error(`demo smoke failed: expected 2 extract records, got ${extractRecords.length}`)
  const cache = await readJson(path.join(temp, '.mnemazine/cache/processed-hashes.json'))
  const cacheOnly = Object.values(cache).filter(value => value && typeof value === 'object' && value.status === 'needs_manual_context')
  if (cacheOnly.length !== 1) throw new Error(`demo smoke failed: expected 1 cache-only source, got ${cacheOnly.length}`)

  await fs.copyFile(path.join(ROOT, 'demo/inbox/example-guide.md'), path.join(inbox, 'cached-guide.md'))
  await must('demo cached-source archive smoke', process.execPath, ['scripts/mnemazine-run.mjs'], {
    env: {
      MNEMAZINE_ROOT: temp,
      MNEMAZINE_INBOX: inbox,
      MNEMAZINE_VAULT: vault
    }
  })
  const cachedInboxFiles = await fs.readdir(inbox)
  if (cachedInboxFiles.length !== 0) throw new Error(`demo cached smoke failed: inbox not empty (${cachedInboxFiles.join(', ')})`)
  const archivedAfterCachedRun = await listFiles(path.join(temp, '.mnemazine/archive'))
  if (archivedAfterCachedRun.length !== 3) throw new Error(`demo cached smoke failed: expected 3 archived sources, got ${archivedAfterCachedRun.length}`)
}

async function qualityAndPublicChecks() {
  await must('demo vault quality', 'npm', ['run', 'quality', '--', '--vault', 'demo/vault'])
  await reportQualityGateSmoke()
  await must('complete gate smoke', 'npm', ['run', 'complete'])
  await must('public release scan', 'npm', ['run', 'public-check'])
}

async function reportQualityGateSmoke() {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'mnemazine-report-gate-'))
  const raw = path.join(temp, 'raw.html')
  const good = path.join(temp, 'good.html')
  await fs.writeFile(raw, [
    '<!doctype html><html><body>',
    '<article><h2>Video keyframe OCR</h2><p>IMG_1234.PNG raw OCR без синтеза.</p></article>',
    '</body></html>'
  ].join(''), 'utf8')
  await fs.writeFile(good, [
    '<!doctype html><html><body>',
    '<main data-knowledge-atom="demo">',
    '<h1>Синтезированные знания</h1>',
    '<section><h2>Синтез</h2><p>Проверенная идея после обработки.</p></section>',
    '<section><h2>Расширил источниками</h2>',
    '<a href="https://example.com/a">a</a>',
    '<a href="https://example.com/b">b</a>',
    '<a href="https://example.com/c">c</a></section>',
    '<section><h2>Где применить</h2><p>В пайплайне.</p></section>',
    '<section><h2>Проверка и риск</h2><p>Проверить источники.</p></section>',
    '<section><h2>Следующее действие</h2><p>Добавить тест.</p></section>',
    '</main></body></html>'
  ].join(''), 'utf8')

  const rawResult = await run(process.execPath, ['scripts/mnemazine-report-quality-gate.mjs', '--report', raw])
  if (rawResult.code === 0) throw new Error('report gate smoke failed: raw OCR report passed')

  await must('report quality gate smoke:good', process.execPath, ['scripts/mnemazine-report-quality-gate.mjs', '--report', good])
}

async function searchEvalSmoke() {
  // Tier A only (0 tokens): recall/anti-noise of the KB search skill. Tier B
  // (LLM judge) is opt-in via `npm run search:eval -- --deep`, not in the gate.
  await must('kb-search selftest', process.execPath, ['scripts/mnemazine-kb-search.mjs', '--selftest'])
  await must('kb-search eval (Tier A)', process.execPath, ['tests/search-eval.mjs'])
}

async function repoMetadataCheck() {
  const pkg = await readJson(path.join(ROOT, 'package.json'))
  if (!pkg.description || !/[А-Яа-яЁё]/.test(pkg.description) || !/[A-Za-z]/.test(pkg.description)) {
    throw new Error('package description must be bilingual')
  }

  // Bilingual READMEs as two files: README.md (English entry) + README.ru.md (Russian).
  const en = await fs.readFile(path.join(ROOT, 'README.md'), 'utf8')
  const ru = await fs.readFile(path.join(ROOT, 'README.ru.md'), 'utf8').catch(() => null)
  if (ru === null) throw new Error('README.ru.md is missing (Russian README required)')

  for (const [label, body] of [['README.md', en], ['README.ru.md', ru]]) {
    if (!body.includes('https://github.com/zarubinphil/Mnemazine.git')) {
      throw new Error(`${label} clone URL is stale or missing`)
    }
  }

  // Each version links to the other so readers can switch languages.
  if (!en.includes('README.ru.md')) throw new Error('README.md must link to README.ru.md')
  if (!ru.includes('README.md')) throw new Error('README.ru.md must link back to README.md')

  // Language sanity: English entry stays English-primary, Russian entry carries Cyrillic.
  if (!/[A-Za-z]/.test(en)) throw new Error('README.md must contain English text')
  if (!/[А-Яа-яЁё]/.test(ru)) throw new Error('README.ru.md must contain Russian text')

  // Section parity (drift guard): both versions must expose the same H2 sections.
  const h2 = body => (body.match(/^##\s+/gm) || []).length
  if (h2(en) !== h2(ru)) {
    throw new Error(`README section parity mismatch: README.md has ${h2(en)} H2, README.ru.md has ${h2(ru)}`)
  }
}

async function main() {
  const checks = [
    ['syntax', checkSyntax],
    ['demo-smoke', demoSmoke],
    ['quality-public', qualityAndPublicChecks],
    ['search-eval', searchEvalSmoke],
    ['repo-metadata', repoMetadataCheck]
  ]
  const passed = []
  for (const [name, fn] of checks) {
    await fn()
    passed.push(name)
    console.log(`ok ${name}`)
  }
  console.log(JSON.stringify({ ok: true, passed }, null, 2))
}

main().catch(error => {
  console.error(error.message || error)
  process.exit(1)
})
