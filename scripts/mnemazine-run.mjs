#!/usr/bin/env node
import { promises as fs } from 'node:fs'
import { existsSync } from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { spawnSync } from 'node:child_process'

const ROOT = process.env.MNEMAZINE_ROOT || path.resolve(process.cwd())
const INBOX = process.env.MNEMAZINE_INBOX || path.join(ROOT, 'inbox')
const VAULT = process.env.MNEMAZINE_VAULT || path.join(ROOT, 'vault')
const REPORTS = process.env.MNEMAZINE_REPORTS || path.join(ROOT, 'reports')
const CACHE = process.env.MNEMAZINE_CACHE || path.join(ROOT, '.mnemazine/cache/processed-hashes.json')
const ARCHIVE = process.env.MNEMAZINE_ARCHIVE || path.join(ROOT, '.mnemazine/archive')
const TRANSCRIPTS = path.join(ROOT, '.mnemazine/cache/video-transcripts')
const VIDEO_AUDIO = path.join(ROOT, '.mnemazine/cache/video-audio')
const VIDEO_FRAMES = path.join(ROOT, '.mnemazine/cache/video-frames')
const VIDEO_QUEUE = path.join(ROOT, '.mnemazine/cache/video-queue.jsonl')
const EXTRACTS = process.env.MNEMAZINE_EXTRACTS || path.join(ROOT, '.mnemazine/cache/extracted')
const SYNTHESIZE = process.env.MNEMAZINE_SYNTHESIZE !== '0'
// Opt-in deep stage (atomization + web/LLM verification, README:230 pipeline).
// Default OFF: the runner stays conservative — local only, no external calls.
// Enable with `--deep` or MNEMAZINE_DEEP=1; forwarded to synthesize.
const DEEP = process.argv.includes('--deep') || process.env.MNEMAZINE_DEEP === '1'
const WHISPER_MODEL = process.env.MNEMAZINE_WHISPER_MODEL || ''
const WHISPER_LANGUAGE = process.env.MNEMAZINE_WHISPER_LANGUAGE || 'ru'
const VIDEO_FRAME_LIMIT = Number(process.env.MNEMAZINE_VIDEO_FRAME_LIMIT || '8')
const VIDEO_INLINE_MAX_SECONDS = Number(process.env.MNEMAZINE_VIDEO_INLINE_MAX_SECONDS || '180')
const COMMAND_TIMEOUT_MS = Number(process.env.MNEMAZINE_COMMAND_TIMEOUT_MS || '120000')
const PROGRESS_EVERY = Number(process.env.MNEMAZINE_PROGRESS_EVERY || '25')

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true })
}

async function sha256(file) {
  const hash = crypto.createHash('sha256')
  hash.update(await fs.readFile(file))
  return hash.digest('hex')
}

async function readJson(file, fallback) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')) } catch { return fallback }
}

function slugify(value) {
  return String(value || 'note')
    .toLowerCase()
    .replace(/[^a-zа-я0-9]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'note'
}

function compact(value, limit = 1400) {
  return String(value || '')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, limit)
}

function sourceRef(hash) {
  return `local-media:${String(hash).slice(0, 16)}`
}

function inferTitle(text, fallback = 'Local source') {
  const clean = compact(text, 500)
  const url = clean.match(/\bhttps?:\/\/[^\s)]+/)?.[0]
  if (url) return url.replace(/^https?:\/\//, '').replace(/[?#].*$/, '').slice(0, 90)
  const line = String(text || '')
    .split(/\n|[.!?]\s+/)
    .map(s => compact(s, 120))
    .find(s => s.length >= 18 && s.length <= 120 && !/^(IMG_|temp_image|screenshot|screen shot)/i.test(s))
  return line || fallback
}

function bullets(text, max = 7) {
  const out = []
  const seen = new Set()
  for (const part of String(text || '').split(/\n|[•*-]\s+/)) {
    const line = compact(part, 180)
    if (line.length < 24) continue
    if (/^(IMG_|temp_image|screenshot|screen shot|save this|follow)/i.test(line)) continue
    const key = line.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(line)
    if (out.length >= max) break
  }
  return out
}

function hasUsableExtraction(text) {
  const clean = compact(text, 2000)
  if (clean.length < 80) return false
  if (/^(Video queued for local Whisper transcription|No extractable text)/i.test(clean)) return false
  const alpha = (clean.match(/[A-Za-zА-Яа-яЁё]/g) || []).length
  return alpha >= 50
}

function isVideo(file) {
  return ['.mp4', '.mov', '.m4v', '.webm', '.mkv'].includes(path.extname(file).toLowerCase())
}

function isImage(file) {
  return ['.png', '.jpg', '.jpeg', '.heic', '.webp', '.tiff'].includes(path.extname(file).toLowerCase())
}

function isMarkitdownDocument(file) {
  return ['.pdf', '.docx', '.pptx', '.xlsx', '.html', '.htm'].includes(path.extname(file).toLowerCase())
}

function videoDurationSeconds(file) {
  const probe = spawnSync('ffmpeg', ['-i', file], { encoding: 'utf8', timeout: COMMAND_TIMEOUT_MS })
  const match = `${probe.stderr}\n${probe.stdout}`.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/)
  if (!match) return null
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3])
}

function whisperModelFor(durationSeconds) {
  if (WHISPER_MODEL) return WHISPER_MODEL
  if (durationSeconds !== null && durationSeconds <= 90) return 'base'
  return 'tiny'
}

async function appendVideoQueue(item) {
  await ensureDir(path.dirname(VIDEO_QUEUE))
  await fs.appendFile(VIDEO_QUEUE, `${JSON.stringify(item)}\n`, 'utf8')
}

async function extractVideo(file, hash) {
  await ensureDir(TRANSCRIPTS)
  await ensureDir(VIDEO_AUDIO)
  await ensureDir(VIDEO_FRAMES)
  const durationSeconds = videoDurationSeconds(file)
  const transcriptPath = path.join(TRANSCRIPTS, `${hash}.txt`)
  if (existsSync(transcriptPath)) {
    const transcript = await fs.readFile(transcriptPath, 'utf8')
    const frames = await extractVideoFrames(file, hash)
    return joinVideoParts(transcript, frames)
  }

  if (durationSeconds !== null && durationSeconds > VIDEO_INLINE_MAX_SECONDS) {
    const frames = await extractVideoFrames(file, hash)
    await appendVideoQueue({
      hash,
      source_ref: sourceRef(hash),
      file,
      duration_seconds: Math.round(durationSeconds),
      status: 'deferred_transcription',
      reason: `duration exceeds inline limit ${VIDEO_INLINE_MAX_SECONDS}s`,
      suggested_command: `MNEMAZINE_WHISPER_MODEL=small MNEMAZINE_VIDEO_INLINE_MAX_SECONDS=999999 node scripts/mnemazine-run.mjs`
    })
    return joinVideoParts('', frames) || `Video queued for local Whisper transcription.\n\nDuration: ${Math.round(durationSeconds)} seconds.\nInline limit: ${VIDEO_INLINE_MAX_SECONDS} seconds.\nSource: ${sourceRef(hash)}`
  }

  const audioPath = path.join(VIDEO_AUDIO, `${hash}.wav`)
  const ffmpeg = spawnSync('ffmpeg', [
    '-y',
    '-i', file,
    '-vn',
    '-ac', '1',
    '-ar', '16000',
    '-f', 'wav',
    audioPath
  ], { encoding: 'utf8', timeout: COMMAND_TIMEOUT_MS })
  if (ffmpeg.status !== 0 || !existsSync(audioPath)) return ''

  const whisper = spawnSync('whisper', [
    audioPath,
    '--model', whisperModelFor(durationSeconds),
    '--language', WHISPER_LANGUAGE,
    '--output_dir', TRANSCRIPTS,
    '--output_format', 'txt',
    '--fp16', 'False',
    '--verbose', 'False'
  ], { encoding: 'utf8', timeout: COMMAND_TIMEOUT_MS })
  const whisperOut = path.join(TRANSCRIPTS, `${hash}.txt`)
  let transcript = ''
  if (whisper.status === 0 && existsSync(whisperOut)) {
    transcript = await fs.readFile(whisperOut, 'utf8')
  }
  const frames = await extractVideoFrames(file, hash)
  return joinVideoParts(transcript, frames)
}

async function extractVideoFrames(file, hash) {
  const ocr = path.join(ROOT, '.mnemazine/bin/vision-ocr')
  if (!existsSync(ocr)) return ''
  const frameDir = path.join(VIDEO_FRAMES, hash)
  await ensureDir(frameDir)
  const existing = (await fs.readdir(frameDir).catch(() => [])).filter(name => name.endsWith('.png'))
  if (!existing.length) {
    spawnSync('ffmpeg', [
      '-y',
      '-i', file,
      '-vf', 'fps=1/3',
      '-frames:v', String(VIDEO_FRAME_LIMIT),
      path.join(frameDir, 'frame-%03d.png')
    ], { encoding: 'utf8', timeout: COMMAND_TIMEOUT_MS })
  }
  const chunks = []
  const seen = new Set()
  const frames = (await fs.readdir(frameDir).catch(() => []))
    .filter(name => name.endsWith('.png'))
    .sort()
    .slice(0, VIDEO_FRAME_LIMIT)
  for (const frame of frames) {
    const out = spawnSync(ocr, [path.join(frameDir, frame)], { encoding: 'utf8', timeout: COMMAND_TIMEOUT_MS })
    if (out.status !== 0) continue
    for (const line of out.stdout.split(/\r?\n/)) {
      const clean = compact(line, 220)
      if (clean.length < 12) continue
      const key = clean.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      chunks.push(clean)
    }
  }
  return chunks.join('\n')
}

function joinVideoParts(transcript, frameText) {
  const parts = []
  if (compact(transcript, 80)) parts.push(`Video transcript from local Whisper:\n\n${transcript.trim()}`)
  if (compact(frameText, 80)) parts.push(`Video keyframe OCR:\n\n${frameText.trim()}`)
  return parts.join('\n\n')
}

async function extract(file) {
  const ext = path.extname(file).toLowerCase()
  if (['.md', '.txt', '.json', '.csv'].includes(ext)) return await fs.readFile(file, 'utf8')
  if (isVideo(file)) return await extractVideo(file, await sha256(file))
  const ocr = path.join(ROOT, '.mnemazine/bin/vision-ocr')
  if (existsSync(ocr) && isImage(file)) {
    const out = spawnSync(ocr, [file], { encoding: 'utf8', timeout: COMMAND_TIMEOUT_MS })
    if (out.status === 0) return out.stdout
  }
  if (isMarkitdownDocument(file)) {
    const markitdown = spawnSync('markitdown', [file], { encoding: 'utf8', timeout: COMMAND_TIMEOUT_MS })
    if (markitdown.status === 0 && markitdown.stdout.trim()) return markitdown.stdout
  }
  return ''
}

async function writeExtractCache(source, hash, text, status) {
  await ensureDir(EXTRACTS)
  const ext = path.extname(source).toLowerCase().replace('.', '') || 'file'
  const ref = sourceRef(hash)
  const record = {
    source_ref: ref,
    source_hash: hash,
    source_type: ext,
    status,
    extracted_at: new Date().toISOString(),
    text_path: compact(text, 80) ? `${hash}.txt` : null
  }
  if (record.text_path) await fs.writeFile(path.join(EXTRACTS, record.text_path), text, 'utf8')
  await fs.writeFile(path.join(EXTRACTS, `${hash}.json`), JSON.stringify(record, null, 2), 'utf8')
  return record
}

async function archiveFile(file, hash) {
  const month = new Date().toISOString().slice(0, 7)
  const dir = path.join(ARCHIVE, month)
  await ensureDir(dir)
  const ext = path.extname(file)
  const target = path.join(dir, `${hash}${ext}`)
  await fs.rename(file, target)
  return target
}

async function main() {
  await ensureDir(INBOX)
  await ensureDir(VAULT)
  await ensureDir(REPORTS)
  await ensureDir(path.dirname(CACHE))
  await ensureDir(ARCHIVE)
  const cache = await readJson(CACHE, {})
  const entries = (await fs.readdir(INBOX, { withFileTypes: true }))
    .filter(d => d.isFile() && !d.name.startsWith('.'))
  let processed = 0
  let cachedOnly = 0
  const toArchive = []
  for (const [index, entry] of entries.entries()) {
    const file = path.join(INBOX, entry.name)
    const hash = await sha256(file)
    if (cache[hash]) continue
    const text = await extract(file)
    if (!hasUsableExtraction(text)) {
      const record = await writeExtractCache(file, hash, text, 'needs_manual_context')
      cache[hash] = { status: record.status, source_ref: record.source_ref, cache: path.relative(ROOT, path.join(EXTRACTS, `${hash}.json`)) }
      toArchive.push({ file, hash })
      cachedOnly += 1
      if (PROGRESS_EVERY > 0 && (index + 1) % PROGRESS_EVERY === 0) {
        console.error(JSON.stringify({ progress: index + 1, total: entries.length, processed, cached_only: cachedOnly }))
      }
      continue
    }
    await writeExtractCache(file, hash, text, 'extracted_for_note')
    cache[hash] = { status: 'extracted_for_note', source_ref: sourceRef(hash), cache: path.relative(ROOT, path.join(EXTRACTS, `${hash}.json`)) }
    toArchive.push({ file, hash })
    processed += 1
    if (PROGRESS_EVERY > 0 && (index + 1) % PROGRESS_EVERY === 0) {
      console.error(JSON.stringify({ progress: index + 1, total: entries.length, processed, cached_only: cachedOnly }))
    }
  }
  await fs.writeFile(CACHE, JSON.stringify(cache, null, 2), 'utf8')
  if (SYNTHESIZE) {
    // Stages: extraction+understanding already done above; synthesize runs
    // research/verification/atomization (deep) and writes vault atoms.
    const synthArgs = [path.join(ROOT, 'scripts/mnemazine-synthesize.mjs')]
    if (DEEP) synthArgs.push('--deep')
    const synth = spawnSync(process.execPath, synthArgs, { stdio: 'inherit', env: process.env })
    if (synth.status !== 0) process.exit(synth.status || 1)
  }
  const quality = spawnSync(process.execPath, [path.join(ROOT, 'scripts/mnemazine-vault-quality-gate.mjs')], { stdio: 'inherit', env: process.env })
  if (quality.status !== 0) process.exit(quality.status || 1)
  const archived = []
  for (const item of toArchive) archived.push(await archiveFile(item.file, item.hash))
  if (spawnSync('graphify', ['--version'], { encoding: 'utf8' }).status === 0) {
    spawnSync('graphify', ['update', VAULT], { stdio: 'inherit' })
  }
  // Deep + final stage: Russian humanizer digest, AFTER the graph so connections
  // are real. Writes a Справка into each note + one session summary note.
  if (DEEP) {
    spawnSync(process.execPath, [path.join(ROOT, 'scripts/mnemazine-digest.mjs')], { stdio: 'inherit', env: process.env })
  }
  console.log(JSON.stringify({ inbox: entries.length, processed, cached_only: cachedOnly, archived: archived.length, deep: DEEP, vault: VAULT }, null, 2))
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
