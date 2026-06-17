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
const CACHE = path.join(ROOT, '.mnemazine/cache/processed-hashes.json')
const ARCHIVE = path.join(ROOT, '.mnemazine/archive')
const TRANSCRIPTS = path.join(ROOT, '.mnemazine/cache/video-transcripts')
const VIDEO_AUDIO = path.join(ROOT, '.mnemazine/cache/video-audio')
const VIDEO_FRAMES = path.join(ROOT, '.mnemazine/cache/video-frames')
const VIDEO_QUEUE = path.join(ROOT, '.mnemazine/cache/video-queue.jsonl')
const EXTRACTS = path.join(ROOT, '.mnemazine/cache/extracted')
const WHISPER_MODEL = process.env.MNEMAZINE_WHISPER_MODEL || ''
const WHISPER_LANGUAGE = process.env.MNEMAZINE_WHISPER_LANGUAGE || 'ru'
const VIDEO_FRAME_LIMIT = Number(process.env.MNEMAZINE_VIDEO_FRAME_LIMIT || '8')
const VIDEO_INLINE_MAX_SECONDS = Number(process.env.MNEMAZINE_VIDEO_INLINE_MAX_SECONDS || '180')

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

function videoDurationSeconds(file) {
  const probe = spawnSync('ffmpeg', ['-i', file], { encoding: 'utf8' })
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
  ], { encoding: 'utf8' })
  if (ffmpeg.status !== 0 || !existsSync(audioPath)) return ''

  const whisper = spawnSync('whisper', [
    audioPath,
    '--model', whisperModelFor(durationSeconds),
    '--language', WHISPER_LANGUAGE,
    '--output_dir', TRANSCRIPTS,
    '--output_format', 'txt',
    '--fp16', 'False',
    '--verbose', 'False'
  ], { encoding: 'utf8' })
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
    ], { encoding: 'utf8' })
  }
  const chunks = []
  const seen = new Set()
  const frames = (await fs.readdir(frameDir).catch(() => []))
    .filter(name => name.endsWith('.png'))
    .sort()
    .slice(0, VIDEO_FRAME_LIMIT)
  for (const frame of frames) {
    const out = spawnSync(ocr, [path.join(frameDir, frame)], { encoding: 'utf8' })
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
  const markitdown = spawnSync('markitdown', [file], { encoding: 'utf8' })
  if (markitdown.status === 0 && markitdown.stdout.trim()) return markitdown.stdout
  const ocr = path.join(ROOT, '.mnemazine/bin/vision-ocr')
  if (existsSync(ocr) && ['.png', '.jpg', '.jpeg', '.heic', '.webp', '.tiff'].includes(ext)) {
    const out = spawnSync(ocr, [file], { encoding: 'utf8' })
    if (out.status === 0) return out.stdout
  }
  return ''
}

function makeNote(source, hash, text) {
  const title = inferTitle(text, 'Unextractable local source')
  const facts = bullets(text)
  const summary = compact(text, 900) || 'No extractable text. Keep this as an unreadable source marker until manual context is added.'
  const ref = sourceRef(hash)
  const ext = path.extname(source).toLowerCase().replace('.', '') || 'file'
  return `---
title: "${title.replace(/"/g, '\\"')}"
type: "knowledge-note"
source_type: "${ext}"
source_ref: "${ref}"
source_hash: "${hash}"
verified: "extraction reviewed; external verification required"
status: "candidate"
---

# ${title}

## What This Is

${summary}

## Why It Matters

This note converts an inbox item into durable knowledge without storing unprocessed extraction text, screenshot names, or copied fragments as the primary memory object.

## Key Points

${facts.length ? facts.map(item => `- ${item}`).join('\n') : '- Local extraction produced too little text. Add manual context or mark the source unreadable.'}

## How To Use It

- Treat this as a local-first knowledge seed.
- Verify current claims against official docs, GitHub, or primary sources before adopting tools or decisions.
- Split into smaller notes when the source contains unrelated ideas.

## Source

- ${ref}

## Verification

- Status: extraction reviewed; external verification required.
- Evidence: SHA-256 source hash.
- Limitation: external facts, dates, prices, stars, and security claims are not confirmed by this run.

## Related Notes

- [[Mnemazine Protocol]]

## Reuse

- Turn stable procedures into skills.
- Turn repeated decisions into checklists.
- Link related notes after Graphify update.
`
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
  for (const entry of entries) {
    const file = path.join(INBOX, entry.name)
    const hash = await sha256(file)
    if (cache[hash]) continue
    const text = await extract(file)
    if (!hasUsableExtraction(text)) {
      const record = await writeExtractCache(file, hash, text, 'needs_manual_context')
      cache[hash] = { status: record.status, source_ref: record.source_ref, cache: path.relative(ROOT, path.join(EXTRACTS, `${hash}.json`)) }
      toArchive.push({ file, hash })
      cachedOnly += 1
      continue
    }
    await writeExtractCache(file, hash, text, 'extracted_for_note')
    const title = inferTitle(text, 'Unextractable local source')
    const noteName = `${new Date().toISOString().slice(0, 10)}-${slugify(title)}-${hash.slice(0, 12)}.md`
    const notePath = path.join(VAULT, '01 Concepts', noteName)
    await ensureDir(path.dirname(notePath))
    await fs.writeFile(notePath, makeNote(file, hash, text), 'utf8')
    cache[hash] = path.relative(VAULT, notePath)
    toArchive.push({ file, hash })
    processed += 1
  }
  await fs.writeFile(CACHE, JSON.stringify(cache, null, 2), 'utf8')
  const quality = spawnSync(process.execPath, [path.join(ROOT, 'scripts/mnemazine-vault-quality-gate.mjs')], { stdio: 'inherit', env: process.env })
  if (quality.status !== 0) process.exit(quality.status || 1)
  const archived = []
  for (const item of toArchive) archived.push(await archiveFile(item.file, item.hash))
  if (spawnSync('graphify', ['--version'], { encoding: 'utf8' }).status === 0) {
    spawnSync('graphify', ['update', VAULT], { stdio: 'inherit' })
  }
  console.log(JSON.stringify({ inbox: entries.length, processed, cached_only: cachedOnly, archived: archived.length, vault: VAULT }, null, 2))
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
