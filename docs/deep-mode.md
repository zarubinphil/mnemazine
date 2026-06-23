# Deep Mode (atomization + verification)

Mnemazine has two operating modes:

- **Conservative (default):** local-only. No network, no LLM, no external services. This is what `node scripts/mnemazine-run.mjs` and `npm run synthesize` do by default.
- **Deep (opt-in):** uses an LLM agent (Claude by default, Codex at parity) to atomize one source into many focused notes (README "one source → ~20 notes") and to verify claims against their sources.

Deep mode is **off unless you ask for it**. Nothing in the default pipeline reaches the network or an LLM.

## Enabling deep mode

```bash
# real Desktop Inbox run, strict full protocol:
npm start

# whole run, deep:
node scripts/mnemazine-run.mjs --deep
# or via env (forwarded to synthesize):
MNEMAZINE_DEEP=1 node scripts/mnemazine-run.mjs

# synthesis only, deep:
npm run synthesize -- --deep
```

For live Desktop Inbox work, use `npm start`. It reads local config, enables deep mode, requires atomization + enrichment, and then runs the completion gate.

If deep mode is requested directly but no LLM engine is available, plain `node scripts/mnemazine-run.mjs --deep` falls back to local template synthesis and reports `degraded: true` in JSON. Strict runs (`--require-deep` or `npm start`) fail before archive.

## The LLM bridge

All LLM calls go through one provider-abstracted module: `scripts/mnemazine-llm.mjs` (`llmJson(prompt, schema, {provider, tools})`). The **code-first engine is Claude** (headless `claude -p`); **Codex is kept at parity** — the same contract, so anything that works via Claude also works via Codex. There is no third LLM client. `mnemazine-codex.mjs` remains as a thin back-compat shim.

### Environment variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `MNEMAZINE_LLM` | `claude` | Engine: `claude` (primary) or `codex` (parity). |
| `MNEMAZINE_CLAUDE_BIN` | auto-discover | Claude CLI: auto-found via login-shell PATH, common installs (npm/Homebrew/standalone/Desktop), or VSCode. Override to pin. |
| `MNEMAZINE_CODEX_BIN` | `/Applications/Codex.app/Contents/Resources/codex` | Path to the Codex binary. |
| `MNEMAZINE_LLM_TIMEOUT_MS` | `420000` | Per-call timeout. |
| `MNEMAZINE_DEEP` | unset | `1` enables deep mode (enrich + atomize + verify + digest). |
| `MNEMAZINE_ENRICH` | `1` within deep | `0` (or `--no-enrich`) skips the enrichment stage. |
| `MNEMAZINE_MAX_ATOMS` | `20` | Cap on atoms produced per source cluster. |
| `MNEMAZINE_CONCURRENCY` | `4` | Swarm size for deep research (parallel agents, bounded). |
| `MNEMAZINE_OWNER_CONTEXT` | generic | Personal project context for the digest's "why it matters". Or put it in the gitignored `.mnemazine/owner-context.txt`. |

### Recognition (local-first, LLM fallback)

Extraction tries local engines first at **0 tokens**: Apple Vision OCR (images), markitdown (PDF/DOCX/PPTX/XLSX/HTML), whisper + frame OCR (video). Only when local yields nothing usable **and** `--deep` is on does a vision-capable LLM transcribe the file. Each file is isolated — one recognition failure logs an error, leaves the file in inbox, and never breaks the rest of the batch.

### Swarm

In deep mode, files/clusters are researched concurrently by a bounded pool of agents (`MNEMAZINE_CONCURRENCY`, default 4) — cheap and fast. A failing task never blocks the others.

### Enrichment (knowledge expansion)

Before atomization, deep mode runs a web-capable LLM agent that **researches and expands** the captured material "as much as is genuinely useful" — primary sources, current facts/versions, practitioner experience — with every added fact tied to a fetched URL (anti-hallucination). Atoms are then built from the **expanded** knowledge, not just the raw capture. Disable with `--no-enrich` / `MNEMAZINE_ENRICH=0`.

### Digest (Russian human-readable summary)

After Graphify, `scripts/mnemazine-digest.mjs` (`npm run digest`) writes a humanizer-style Russian **Справка** into each note — *Что это / О чём / Почему важно мне / Связи* — plus one session summary note mapping all atoms. Connections (*Связи*) are derived directly from note metadata: atoms sharing a `cluster_id` (siblings from one source) and atoms sharing a source-URL host. Deterministic, no model key needed. (`graphify update` builds only the intra-note structural code-graph; richer note-to-note semantic links would need the separate `graphify --update` pass and are not relied upon here.) This is the reuse surface: open one note, understand the knowledge and how it connects. Idempotent (skips notes that already have a Справка unless `--force`).

### Atomization (G4)

`scripts/mnemazine-synthesize.mjs` (with `--deep`/`--atomize`) sends each source cluster to the LLM and asks for focused atoms — each with a title, what/why, how-to bullets, a next action, and the supporting source URLs. Each atom becomes its own note. Filenames are content-fingerprinted (scoped by cluster id) so re-runs are idempotent and never clobber an existing note.

### Verification (G5)

`scripts/mnemazine-verify.mjs` assigns each note a `verification_status`:

- `unknown` — no source URL anchored the claim;
- `assumed` — a source URL is present but was not fetched/checked (the **default local** verdict, zero network);
- `verified` — only under `--deep`: the source was reachable (HEAD/GET) **and** an LLM web cross-check judged it to support the claim. Such notes get `verified: true` and `status: final`.

## Security

### Untrusted input is fenced

Extracted material (OCR, transcripts, scraped web text) is **untrusted**. Before it is placed into any LLM prompt it is wrapped by `fenceUntrusted()` — an inert-data delimiter plus an explicit instruction that the content must never be executed as commands. Any literal occurrence of the fence sentinel inside the content is neutralized. This is the primary defense against prompt injection through captured material.

### Sandbox

The Claude backend runs `claude -p` without `--dangerously-skip-permissions`; unpermitted tools simply do not run. The Codex backend runs headless with the bypass flag the repo's `kb-*-codex.sh` pipeline uses (non-interactive execution needs it). Either way the prompt-layer fencing above is the active mitigation, and tightening a backend sandbox further is a deliberate, separate decision — not required for default (conservative) operation, which never invokes Codex at all.

### Data boundary

Deep verification (`--deep`) sends claim text and source URLs to the LLM agent, which performs web search — so locally-derived text reaches external search services **only under `--deep`**. The conservative default never does this.

### Local secret scan

`npm run release-check` (and `npm run public-check`) scan not only what could ship publicly but also the local extraction cache (`.mnemazine/cache/extracted/`) for token-like secrets (API keys, tokens, private keys), because captured screenshots or PDFs can contain credentials that would otherwise flow into synthesized notes. A captured secret fails the gate.
