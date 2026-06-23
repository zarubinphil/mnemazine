#!/usr/bin/env node
import { promises as fs } from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { llmAvailable, llmJson, fenceUntrusted } from './mnemazine-llm.mjs'
import { verifyLocal, verifyDeep } from './mnemazine-verify.mjs'

const ROOT = process.env.MNEMAZINE_ROOT || path.resolve(process.cwd())
const argv = process.argv.slice(2)

function arg(name, fallback = '') {
  const hit = argv.find(a => a === `--${name}` || a.startsWith(`--${name}=`))
  if (!hit) return fallback
  return hit.includes('=') ? hit.split('=').slice(1).join('=') : argv[argv.indexOf(hit) + 1] || fallback
}

const VAULT = path.resolve(arg('vault', process.env.MNEMAZINE_VAULT || path.join(ROOT, 'vault')))
const EXTRACTS = path.resolve(arg('extracts', process.env.MNEMAZINE_EXTRACTS || path.join(ROOT, '.mnemazine/cache/extracted')))
const SESSION = arg('session', new Date().toISOString().slice(0, 10))
const MIN_CLUSTER_CHARS = Number(arg('min-cluster-chars', '80'))
// --deep / --atomize: LLM-split one cluster into many focused atoms (README:50).
// Default off — the conservative path (release demo, run.mjs) stays local-only
// and never needs codex. Flag also honoured via MNEMAZINE_DEEP=1.
const DEEP = argv.includes('--deep') || argv.includes('--atomize') || process.env.MNEMAZINE_DEEP === '1'
const MAX_ATOMS = Number(arg('max-atoms', process.env.MNEMAZINE_MAX_ATOMS || '20'))
// Enrichment is on within --deep unless explicitly disabled (it needs the network).
const ENRICH = DEEP && process.env.MNEMAZINE_ENRICH !== '0' && !argv.includes('--no-enrich')

const sourceHints = [
  { re: /mcp|model context protocol|filesystem mcp|memory mcp|zapier/i, name: 'Model Context Protocol docs', url: 'https://modelcontextprotocol.io/docs/getting-started/intro' },
  { re: /skill|skills|claude code|agent skill|subagent/i, name: 'Anthropic Agent Skills', url: 'https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills' },
  { re: /spec|spec-driven|feature forge|requirements/i, name: 'GitHub Spec Kit', url: 'https://github.com/github/spec-kit' },
  { re: /prompt injection|security|secure|guard|review/i, name: 'OWASP LLM01 Prompt Injection', url: 'https://genai.owasp.org/llmrisk/llm01-prompt-injection/' },
  { re: /observability|logs|metrics|traces|otel/i, name: 'OpenTelemetry docs', url: 'https://opentelemetry.io/docs/' },
  { re: /secret|env|credential|api key/i, name: 'Infisical secrets docs', url: 'https://infisical.com/docs/documentation/platform/secrets-mgmt/overview' },
  { re: /design\.md|getdesign|design system|wcag|accessibility|ui|frontend/i, name: 'getdesign.md', url: 'https://getdesign.md/' },
  { re: /browser|playwright|agent-browser|browser-use/i, name: 'Playwright docs', url: 'https://playwright.dev/docs/intro' },
  { re: /obsidian|vault|wiki|memory|knowledge|graph/i, name: 'Karpathy LLM Wiki', url: 'https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f' },
  { re: /terraform|pulumi|infrastructure|iac/i, name: 'Terraform docs', url: 'https://developer.hashicorp.com/terraform/docs' },
  { re: /bff|backend for frontend/i, name: 'Backends for Frontends pattern', url: 'https://learn.microsoft.com/en-us/azure/architecture/patterns/backends-for-frontends' },
  { re: /worktree|git stash/i, name: 'git worktree docs', url: 'https://git-scm.com/docs/git-worktree' },
  { re: /moneyprinter|short-form|reels|tiktok|youtube shorts/i, name: 'MoneyPrinterTurbo', url: 'https://github.com/harry0703/MoneyPrinterTurbo' }
]

const clusterRules = [
  { id: 'agent-systems', title: 'Agent systems and reusable capabilities', re: /agent|claude|skill|subagent|mcp|jarvis|harness|memory|codex/i },
  { id: 'knowledge-memory', title: 'Knowledge memory, vaults, and synthesis loops', re: /obsidian|vault|wiki|knowledge|graph|weekly synthesis|belief|decision/i },
  { id: 'security-review', title: 'Security, review, and trust boundaries', re: /security|secret|prompt injection|review|guard|permission|wcag|accessibility/i },
  { id: 'engineering-ops', title: 'Engineering operations and reproducible delivery', re: /observability|terraform|pulumi|worktree|staging|environment|deploy|bff|backend/i },
  { id: 'design-frontend', title: 'Design systems and frontend quality', re: /design|frontend|ui|component|playwright|browser|layout|wcag/i },
  { id: 'tool-radar', title: 'Open-source tool radar and selection', re: /github\.com|open source|langflow|dify|open-webui|openhands|crawl4ai|coolify|papermark|twenty|crowdsec/i },
  { id: 'content-growth', title: 'Content experiments and growth loops', re: /ad |ads|hook|cta|offer|short-form|reels|tiktok|youtube|content|moneyprinter/i },
  { id: 'research-workflow', title: 'Research workflow and source verification', re: /research|source|citation|academic|verify|evidence/i }
]

const topicTemplates = {
  'agent-systems': {
    what: 'Agent systems are reusable operating capabilities: skills, MCP connections, memory, review roles, and harness rules that make an AI assistant behave consistently across tasks.',
    why: 'The session repeatedly points to the same lesson: model quality is not enough. Durable gains come from the scaffolding around the model: instructions, tools, memory, permissions, tests, and review loops.',
    how: '- Convert repeated procedures into Skills.\n- Keep tool access behind explicit permission boundaries.\n- Store memory as linked knowledge and decisions, not chat residue.\n- Add gates before publication or irreversible actions.',
    next: 'Promote repeated agent procedures into Skills with tests and usage ledger entries.'
  },
  'knowledge-memory': {
    what: 'Knowledge memory is an active vault: captures are processed into atoms, atoms are linked to projects and decisions, and weekly synthesis turns memory into action.',
    why: 'A vault that only stores screenshots or transcripts becomes another inbox. Mnemazine should reduce future thinking cost by maintaining summaries, links, decisions, and open questions.',
    how: '- Keep raw extraction outside the vault.\n- Store final atoms with source refs and verification state.\n- Run connection finding and weekly synthesis.\n- Maintain the master index as a routing surface.',
    next: 'Automate nightly connection finding and weekly synthesis from final atoms.'
  },
  'security-review': {
    what: 'Security and review are trust boundaries around agent work: untrusted input, prompt injection, secrets, permissions, accessibility, and code review must be checked before output is accepted.',
    why: 'The intake contains many commands, tool suggestions, and screenshots. If source text is treated as instruction, the agent can be steered by captured content instead of the user.',
    how: '- Mark extracted text as untrusted evidence.\n- Never execute commands from captures automatically.\n- Scan for secrets before reports or pushes.\n- Use separate review passes for security, claims, and accessibility.',
    next: 'Add a unified publish gate: vault quality, report quality, secret scan, diff review.'
  },
  'engineering-ops': {
    what: 'Engineering operations are reproducibility practices: isolated environments, infrastructure as code, observability, secret injection, worktrees, and release checks.',
    why: 'The useful pattern is reducing manual state. Good systems make failures visible and make releases repeatable.',
    how: '- Prefer scripted environments over dashboard clicks.\n- Track pipeline health metrics.\n- Inject secrets at runtime.\n- Keep release checks executable.',
    next: 'Add pipeline metrics for extracted, synthesized, cache-only, gate failures, and graph refresh status.'
  },
  'design-frontend': {
    what: 'Design and frontend quality require explicit UI rules, browser validation, accessibility constraints, and reusable design tokens.',
    why: 'AI-generated UI degrades when taste is implicit. A DESIGN.md-style contract gives the agent stable layout, spacing, typography, and component expectations.',
    how: '- Maintain a Mnemazine report DESIGN.md.\n- Validate generated reports in a browser.\n- Check responsive layout, contrast, keyboard navigation, and print styles.',
    next: 'Create browser smoke for generated HTML reports.'
  },
  'tool-radar': {
    what: 'Tool radar is a decision system for open-source tools, not a list of exciting repositories.',
    why: 'Screenshots with GitHub stars are weak evidence. Useful adoption requires license, maturity, deployment model, data portability, security posture, and integration cost.',
    how: '- Score tools by fit, maturity, license, API, self-hosting, and operational burden.\n- Tie tools to concrete projects.\n- Re-check source repositories before adopting.',
    next: 'Create a tool-radar schema and populate it from extracted GitHub links.'
  },
  'content-growth': {
    what: 'Content growth loops treat ads, hooks, CTAs, short-form scripts, and publishing as experiments with feedback.',
    why: 'One generated video or ad is not learning. Learning appears when variants, metric, result, and next control are stored.',
    how: '- Store hypothesis, channel, variant, metric, result, and decision.\n- Keep winners as controls.\n- Discard weak variants without preserving noise as knowledge.',
    next: 'Add a Content Experiment note template.'
  },
  'research-workflow': {
    what: 'Research workflow means claims are sourced before they become operational knowledge.',
    why: 'A source link is not decoration. It should confirm, correct, or constrain the conclusion.',
    how: '- Separate extracted claim from verified conclusion.\n- Prefer official docs and primary repositories.\n- Record confidence and what the source changed.',
    next: 'Add `source_changed_what` to final atom schema.'
  },
  misc: {
    what: 'Miscellaneous signals are captured items that do not yet form a strong enough reusable cluster.',
    why: 'Keeping them separate prevents weak or noisy items from polluting stronger knowledge atoms.',
    how: '- Review manually.\n- Promote only recurring or high-value ideas.\n- Move low-signal material to forget/archive.',
    next: 'Manually review miscellaneous signals and either promote or forget them.'
  }
}

function compact(value, limit = 1200) {
  return String(value || '')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, limit)
}

function slugify(value) {
  return String(value || 'note')
    .toLowerCase()
    .replace(/[^a-zа-я0-9]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 72) || 'note'
}

function uniq(values) {
  return [...new Set(values.filter(Boolean))]
}

// Content fingerprint = stable hash of a cluster's sorted source refs. Same
// inputs -> same fingerprint -> same filename, so re-runs are idempotent and
// exact-duplicate clusters are not rewritten (see write loop skip).
// ponytail: exact-dup only via source-ref hash; near-duplicate (paraphrase)
// dedup needs embeddings — wire fastembed/Ollama here if dup clusters appear.
function fingerprint(cluster) {
  const refs = cluster.records.map(record => String(record.source_ref || "")).sort()
  const key = [cluster.id || "", cluster.part || 1, ...refs].join(" ")
  return crypto.createHash("sha1").update(key).digest("hex").slice(0, 10)
}

function extractUrls(text) {
  return uniq(String(text || '').match(/\bhttps?:\/\/[^\s)]+/g) || [])
    .map(url => url.replace(/[.,;]+$/, ''))
    .filter(url => !/^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0)([:/]|$)/i.test(url))
    .slice(0, 8)
}

function bullets(text, max = 8) {
  const out = []
  const seen = new Set()
  for (const part of String(text || '').split(/\n|[•*-]\s+|(?<=[.!?])\s+/)) {
    const line = compact(part, 190)
    if (line.length < 32) continue
    if (/^(video keyframe ocr|video transcript|img_|temp_image|follow|subscribe|save this)/i.test(line)) continue
    const key = line.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(line)
    if (out.length >= max) break
  }
  return out
}

function classify(text) {
  const hit = clusterRules.find(rule => rule.re.test(text))
  return hit ? hit.id : 'misc'
}

function clusterTitle(id) {
  return clusterRules.find(rule => rule.id === id)?.title || 'Miscellaneous knowledge signals'
}

function publicSources(text) {
  const explicit = extractUrls(text).map(url => ({ name: url.includes('github.com') ? 'GitHub source' : 'Source link', url }))
  const hinted = sourceHints
    .filter(source => source.re.test(text))
    .map(({ name, url }) => ({ name, url }))
  const byUrl = new Map()
  for (const source of [...explicit, ...hinted]) byUrl.set(source.url, source)
  return [...byUrl.values()].slice(0, 10)
}

function recordTitle(record) {
  const url = extractUrls(record.text)[0]
  if (url) return url.replace(/^https?:\/\//, '').replace(/[?#].*$/, '').slice(0, 90)
  const title = String(record.text || '')
    .split(/\n|[.!?]\s+/)
    .map(line => compact(line, 120))
    .find(line => line.length >= 18 && !/^(video keyframe ocr|video transcript|img_|temp_image|сообщество подписки|рекомендации)/i.test(line))
  return title || record.source_ref
}

function hostOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, '') } catch { return '' }
}

function topicSignals(cluster, sources) {
  const hosts = uniq(sources.map(source => hostOf(source.url)).filter(Boolean)).slice(0, 6)
  const sourceLine = hosts.length ? `Detected public sources: ${hosts.join(', ')}.` : 'No stable public URL detected in this cluster.'
  const map = {
    'agent-systems': ['Repeated agent capability signals: Skills, MCP, memory, browser tools, review roles, and harness rules.', sourceLine],
    'knowledge-memory': ['Repeated memory signals: vault structure, connection finding, weekly synthesis, decisions, beliefs, and active indexes.', sourceLine],
    'security-review': ['Repeated trust signals: prompt injection risk, secret handling, permissions, review gates, and accessibility checks.', sourceLine],
    'engineering-ops': ['Repeated engineering signals: reproducible environments, IaC, worktrees, observability, release checks, and secret injection.', sourceLine],
    'design-frontend': ['Repeated UI signals: DESIGN.md, taste rules, frontend structure, Playwright/browser checks, and WCAG constraints.', sourceLine],
    'tool-radar': ['Repeated tool-radar signals: GitHub repositories, self-hosting options, AI tools, and open-source alternatives.', sourceLine],
    'content-growth': ['Repeated growth signals: ad variants, hooks, CTAs, short-form generation, metrics, and winner/loser loops.', sourceLine],
    'research-workflow': ['Repeated research signals: source gathering, claim review, evidence checking, drafting, and revision.', sourceLine],
    misc: ['Low-confidence miscellaneous signals kept separate from stronger clusters.', sourceLine]
  }
  return map[cluster.id] || map.misc
}

async function listRecords() {
  const records = []
  for (const entry of await fs.readdir(EXTRACTS, { withFileTypes: true }).catch(() => [])) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue
    const file = path.join(EXTRACTS, entry.name)
    let record
    try {
      record = JSON.parse(await fs.readFile(file, 'utf8'))
    } catch (err) {
      console.error(`[synthesize] skipping corrupt extract cache ${entry.name}: ${err.message}`)
      continue
    }
    if (record.status !== 'extracted_for_note' || !record.text_path) continue
    const textFile = path.join(EXTRACTS, record.text_path)
    const text = await fs.readFile(textFile, 'utf8').catch(() => '')
    if (compact(text, 100).length < 40) continue
    records.push({ ...record, text })
  }
  return records
}

function chunks(values, size) {
  const out = []
  for (let i = 0; i < values.length; i += size) out.push(values.slice(i, i + size))
  return out
}

function makeNote(cluster) {
  const text = cluster.records.map(record => record.text).join('\n\n')
  const baseTitle = clusterTitle(cluster.id)
  const title = cluster.partCount > 1 ? `${baseTitle} ${cluster.part}/${cluster.partCount}` : baseTitle
  const template = topicTemplates[cluster.id] || topicTemplates.misc
  const sources = publicSources(text)
  const signals = topicSignals(cluster, sources)
  const sourceRefs = cluster.records.map(record => `- ${record.source_ref}`)
  const sourceLines = sources.length
    ? sources.map(source => `- ${source.name}: ${source.url}`)
    : ['- No public source detected in extraction; external verification required before operational adoption.']
  const sourceStatus = sources.length ? 'local synthesis with public source expansion' : 'local synthesis; external verification required'
  const localVerdict = verifyLocal(sources.map(s => s.url))
  const risk = sources.length
    ? 'Public links were detected or added by topic hints, but claims still need project-specific validation before adoption.'
    : 'No public source was available in extracted text; treat this as a local memory atom, not an externally verified claim.'
  return `---
title: "${title.replace(/"/g, '\\"')}"
type: "knowledge-note"
source_type: "synthesis-cluster"
source_ref: "session:${SESSION}/${cluster.id}"
verified: false
verification_status: "${localVerdict.status}"
verification: "${sourceStatus}"
status: "draft"
cluster_size: ${cluster.records.length}
cluster_fingerprint: "${fingerprint(cluster)}"
---

# ${title}

## What This Is

${template.what}

Key session signals:
${signals.map(signal => `- ${signal}`).join('\n')}

## Why It Matters

${template.why}

This note condenses ${cluster.records.length} extracted source item${cluster.records.length === 1 ? '' : 's'} into reusable knowledge. Source-level extraction stays in \`.mnemazine/cache/extracted\`.

## How To Use It

${template.how}

## Source

Local source refs:
${sourceRefs.slice(0, 30).join('\n')}
${sourceRefs.length > 30 ? `- ... ${sourceRefs.length - 30} more source refs kept in extraction cache` : ''}

Public/source expansion:
${sourceLines.join('\n')}

## Verification

- **No automated fact-check ran.** This note is an unverified synthesis cluster (\`status: draft\`). Source URLs are detected from extracted text or added by topic hints — they are pointers, not confirmation that any specific claim is true.
- Promote to \`status: final\` only after a human or the verify gate checks claims against the listed primary sources.
- Confidence: low until verified — treat dates, prices, stars, security claims, and release status as unconfirmed.
- Risk: ${risk}

## Related Notes

- [[Mnemazine Protocol]]
- [[${clusterTitle(cluster.id)}]]

## Reuse

- Next action: ${template.next}
`
}

const ATOM_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['atoms'],
  properties: {
    atoms: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'what', 'why', 'how', 'next', 'sources'],
        properties: {
          title: { type: 'string' },
          what: { type: 'string' },
          why: { type: 'string' },
          how: { type: 'array', items: { type: 'string' } },
          next: { type: 'string' },
          sources: { type: 'array', items: { type: 'string' } }
        }
      }
    }
  }
}

function atomPrompt(cluster, sources, materialOverride) {
  // When enrichment ran, atomize the EXPANDED knowledge; else the raw capture.
  const text = materialOverride
    ? String(materialOverride).slice(0, 28000)
    : cluster.records.map(r => compact(r.text, 4000)).join('\n---\n').slice(0, 24000)
  const urls = sources.map(s => s.url).join(', ') || 'none detected'
  return `You are Mnemazine's atomization agent. Split the raw material below into FOCUSED, atomic knowledge notes — one idea per atom, up to ${MAX_ATOMS}. Do NOT merge unrelated ideas; do NOT invent facts not present in the material. Each atom: a precise title, a one-paragraph "what", a one-paragraph "why it matters", 2-5 concrete "how to use" bullets, one "next action", and the subset of source URLs that support it (from: ${urls}; [] if none).

Return ONLY JSON matching the schema.

${fenceUntrusted('MATERIAL', text)}`
}

async function atomizeCluster(cluster, sources, materialOverride) {
  const result = await llmJson(atomPrompt(cluster, sources, materialOverride), ATOM_SCHEMA)
  const atoms = Array.isArray(result?.atoms) ? result.atoms : []
  return atoms.filter(a => a && a.title && a.what).slice(0, MAX_ATOMS)
}

// --- Enrichment (knowledge EXPANSION, README "research", G/B) ---
// A web-capable LLM agent researches the captured material and grows it "as much
// as truly needed": pulls primary sources, current facts/versions, practitioner
// experience — each added fact tied to a fetched URL (anti-hallucination). Output
// feeds atomize, so atoms are built from EXPANDED knowledge, not just the capture.
const ENRICH_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['enriched', 'sources', 'added_facts'],
  properties: {
    enriched: { type: 'string' },
    sources: { type: 'array', items: { type: 'string' } },
    added_facts: { type: 'array', items: { type: 'string' } }
  }
}

function enrichPrompt(text, sources) {
  const urls = sources.map(s => s.url).join(', ') || 'none detected'
  return `You are Mnemazine's research-enrich agent. The MATERIAL below is a SEED, not the final knowledge. Research it with available tools (web search, web fetch, and any configured MCP web tools) and EXPAND it as much as is genuinely useful — no padding. Pull: the primary source, current facts/numbers/versions, concrete examples, and real practitioner experience (issues, pros/cons, gotchas) with thread/issue URLs. Anti-hallucination: every added fact MUST trace to a fetched URL; if unconfirmed, say so, do not strengthen it. Keep it tight and factual.

Known source hints: ${urls}.

Produce: "enriched" = the expanded knowledge as clean prose (English ok; the human-readable Russian digest is a later stage), "sources" = all source URLs used, "added_facts" = short bullet list of what you added beyond the seed.

${fenceUntrusted('MATERIAL', text)}`
}

async function enrichCluster(cluster, sources) {
  const text = cluster.records.map(r => compact(r.text, 6000)).join('\n---\n').slice(0, 24000)
  const res = await llmJson(enrichPrompt(text, sources), ENRICH_SCHEMA, {
    tools: ['WebSearch', 'WebFetch', 'mcp__firecrawl', 'mcp__tavily']
  })
  const enriched = typeof res?.enriched === 'string' ? res.enriched.trim() : ''
  const addedSources = Array.isArray(res?.sources) ? res.sources.filter(Boolean) : []
  return { enriched, addedSources }
}

function atomFingerprint(atom, clusterId = '') {
  // clusterId scopes the hash so identical titles in different clusters (common
  // for sourceless low-confidence atoms) get distinct filenames, not silent skips.
  const key = [clusterId, atom.title, ...(atom.sources || []).slice().sort()].join('|')
  return crypto.createHash('sha1').update(key).digest('hex').slice(0, 10)
}

function makeAtomNote(cluster, atom, verdict) {
  const how = (atom.how || []).filter(Boolean).map(h => `- ${compact(h, 240)}`).join('\n') || '- Review and apply in context.'
  const srcs = (atom.sources || []).filter(Boolean)
  const sourceLines = srcs.length
    ? srcs.map(u => `- ${hostOf(u) || 'Source'}: ${u}`).join('\n')
    : '- No public source detected; external verification required before operational adoption.'
  const fp = atomFingerprint(atom, cluster.id)
  const v = verdict || { status: 'unknown', note: '' }
  const isVerified = v.status === 'verified'
  return `---
title: "${String(atom.title).replace(/"/g, '\\"').slice(0, 120)}"
type: "knowledge-note"
source_type: "synthesis-atom"
source_ref: "session:${SESSION}/${cluster.id}#${fp}"
verified: ${isVerified}
verification_status: "${v.status}"
verification: "llm-atomized; ${String(v.note || 'sources unverified').replace(/"/g, "'")}"
status: "${isVerified ? 'final' : 'draft'}"
cluster_id: "${cluster.id}"
cluster_fingerprint: "${fp}"
---

# ${compact(atom.title, 120)}

## What This Is

${compact(atom.what, 1200)}

## Why It Matters

${compact(atom.why, 1200)}

## How To Use It

${how}

## Source

${sourceLines}

## Verification

- Verification status: **${v.status}**${v.note ? ` (${v.note})` : ''}.
${isVerified
  ? `- A deep verify pass cross-checked the claim against the listed sources.${v.evidence ? ` Evidence: ${compact(v.evidence, 300)}` : ''}`
  : '- **No claim-level fact-check confirmed this.** Source URLs are pointers, not confirmation. Promote to `verified` only after the deep verify gate (`--deep`) checks claims against the listed sources.'}
- ${v.status === 'unknown' ? 'No source URL was anchored — treat as a local memory atom, not an externally verified claim.' : 'Confidence: medium until a human or deep verify confirms.'}

## Related Notes

- [[Mnemazine Protocol]]
- [[${clusterTitle(cluster.id)}]]

## Reuse

- Next action: ${compact(atom.next, 240) || 'Review and apply.'}
`
}

await fs.mkdir(path.join(VAULT, '01 Concepts'), { recursive: true })
const records = await listRecords()
const clusters = new Map()
for (const record of records) {
  const id = classify(record.text)
  if (!clusters.has(id)) clusters.set(id, { id, records: [] })
  clusters.get(id).records.push(record)
}

let written = 0
let skipped = 0
let atomized = 0
let enriched_clusters = 0
const useAtomize = DEEP && llmAvailable()
if (DEEP && !llmAvailable()) {
  console.error('[synthesize] --deep requested but LLM unavailable; falling back to local template synthesis')
}
// Bounded-concurrency pool — the research swarm. Each part is an independent
// agent task; one failing never blocks the others (each is try/caught inside).
async function mapLimit(items, limit, fn) {
  let i = 0
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (i < items.length) { const idx = i++; await fn(items[idx]) }
  })
  await Promise.all(workers)
}

async function processPart(part, parts, index) {
  if (useAtomize) {
    try {
      const sources = publicSources(part.records.map(r => r.text).join('\n\n'))
      // Expand the knowledge first (research), then atomize the EXPANDED material.
      let material
      if (ENRICH) {
        try {
          const { enriched, addedSources } = await enrichCluster(part, sources)
          if (enriched && enriched.length > 200) {
            material = enriched
            for (const u of addedSources) if (!sources.some(s => s.url === u)) sources.push({ name: hostOf(u) || 'Source', url: u })
            enriched_clusters += 1
          }
        } catch (err) {
          console.error(`[synthesize] enrich failed for cluster ${part.id}: ${err.message}; atomizing raw capture`)
        }
      }
      const atoms = await atomizeCluster(part, sources, material)
      let wroteAtom = false
      for (const atom of atoms) {
        const out = path.join(VAULT, '01 Concepts', `synthesis-${slugify(atom.title)}-${atomFingerprint(atom, part.id)}.md`)
        if (await fs.access(out).then(() => true).catch(() => false)) { skipped += 1; continue }
        const verdict = DEEP
          ? await verifyDeep(`${atom.what}\n${atom.why}`, atom.sources)
          : verifyLocal(atom.sources)
        await fs.writeFile(out, makeAtomNote(part, atom, verdict), 'utf8')
        atomized += 1
        wroteAtom = true
      }
      if (wroteAtom) return // atomized this cluster — skip the template note
      console.error(`[synthesize] atomize produced no atoms for cluster ${part.id}; using template note`)
    } catch (err) {
      console.error(`[synthesize] atomize failed for cluster ${part.id}: ${err.message}; using template note`)
    }
  }

  const suffix = parts.length > 1 ? `-part-${index + 1}` : ''
  // Filename keyed by content fingerprint, not date: idempotent across runs.
  const fp = fingerprint(part)
  const out = path.join(VAULT, '01 Concepts', `synthesis-${slugify(clusterTitle(part.id))}${suffix}-${fp}.md`)
  if (await fs.access(out).then(() => true).catch(() => false)) { skipped += 1; return }
  await fs.writeFile(out, makeNote(part), 'utf8')
  written += 1
}

const tasks = []
for (const cluster of clusters.values()) {
  const parts = chunks(cluster.records, 25)
  parts.forEach((recs, index) => {
    const part = { ...cluster, records: recs, part: index + 1, partCount: parts.length }
    const textSize = part.records.reduce((sum, record) => sum + compact(record.text, 100000).length, 0)
    if (textSize < MIN_CLUSTER_CHARS) return
    tasks.push({ part, parts, index })
  })
}
// Swarm only helps when each task spawns an agent (deep); local template writes
// stay serial. Cap concurrency so we are cheap+fast, not a fork bomb.
const CONCURRENCY = Number(arg('concurrency', process.env.MNEMAZINE_CONCURRENCY || '4'))
await mapLimit(tasks, useAtomize ? CONCURRENCY : 1, async ({ part, parts, index }) => {
  // Outer guard: a part must never break the swarm, even on an unexpected throw.
  try { await processPart(part, parts, index) }
  catch (err) { console.error(`[synthesize] part failed for cluster ${part.id}: ${err.message}`) }
})

// degraded: --deep was requested but the deep path could not run (codex absent),
// so the run silently fell back to local templates. Callers can detect this.
const degraded = DEEP && !llmAvailable()
console.log(JSON.stringify({ ok: true, degraded, records: records.length, clusters: clusters.size, written, atomized, enriched: enriched_clusters, skipped }, null, 2))
