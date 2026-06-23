# Mnemazine

🇬🇧 **English** · [🇷🇺 Русский](README.ru.md)

<p align="center">
  <img src="docs/assets/hero/mnemazine-hero.png" width="820" alt="Mnemazine — Mnemosyne, goddess of memory, beside her marble column, distilling raw fragments into a layered knowledge system">
</p>

**Mnemazine** is an open-source personal memory system, named after **Mnemosyne**, the Greek goddess of memory and mother of the Muses.

The idea behind it is simple. Most people pile up notes, screenshots, and saved links and never look at them again. A pile is not memory. Real memory is what happens when you take something raw, understand it, check it, connect it to what you already know, and write down only the part worth keeping. Mnemazine does that part for you at the moment of saving.

The technique has a name — **synthesis on write** — popularized by [Andrej Karpathy](https://karpathy.ai/): don't dump and hope to read it later; distill the essence as you capture it, so the note is already useful the next time you open it.

In practice, Mnemazine takes screenshots, PDFs, web pages, YouTube videos, notes, guides, and GitHub repositories and turns them into a clean, [Obsidian](https://obsidian.md/)-compatible knowledge base. It extracts text locally first, keeps a source hash so you always know where a fact came from, stores only finished notes, links them into a graph, and refuses to let raw OCR or messy drafts leak into your vault.

> Memory, not a dump.

<p align="center">
  <img src="docs/assets/hero/mnemazine-synthesis.png" width="760" alt="Synthesis on write: many raw fragments are squeezed through to a single durable note">
</p>

## What It Is

Mnemazine is a local-first knowledge refinery. Material goes in raw; finished knowledge comes out.

It does not save raw OCR into your vault. It does not keep vague summaries that are impossible to reuse. It tries to produce finished knowledge:

- clear notes with understandable titles;
- source links and verification status;
- topic-based atomization when one source contains many ideas;
- reusable skill descriptions, agent instructions, implementation notes, and project actions;
- Graphify maps for semantic navigation;
- weekly HTML briefings with local state: `read`, `work on it`, `forget`.
- post-run visual knowledge reports: clusters, small atoms, duplicate accounting, and top-20 recommended actions.

The goal is simple: future you should not reread twenty screenshots, a whole guide, or a messy transcript. Future you should open one good note and immediately understand what the knowledge is, why it matters, how to use it, and what evidence supports it.

## Why It Saves Tokens

Mnemazine saves tokens by moving work out of repeated LLM context and into durable local structure: parse locally, cache aggressively, store refined atoms, retrieve narrowly.

<p align="center">
  <img src="docs/assets/hero/mnemazine-token.png" width="760" alt="Token economics: parse locally, hash cache, store atoms, retrieve narrowly">
</p>

Typical savings come from:

- **Local extraction first:** Apple Vision OCR, PDF parsing, transcription, hashing, and file census happen locally when possible.
- **Hash cache:** repeated files are detected before LLM processing. A duplicate costs zero model tokens.
- **Atomization:** one long guide can become twenty focused notes, so future prompts pull only the relevant atom.
- **Graphify context:** the agent can query a graph instead of dumping the whole vault into context.
- **Final notes only:** raw OCR and noisy transcripts stay outside the vault. The vault stores condensed, verified, human-readable knowledge.
- **Weekly briefs:** the system surfaces what changed and what deserves action, so the user does not ask the model to rediscover the week.

In real workflows, this often turns huge source piles into compact reusable notes. The exact savings depend on source size, but the operating principle is reliable: parse locally, cache aggressively, store refined atoms, retrieve narrowly.

## Install

Clone the project into the only folder you need:

```bash
git clone https://github.com/zarubinphil/Mnemazine.git "$HOME/Desktop/Mnemazine"
cd "$HOME/Desktop/Mnemazine"
bash setup.sh        # guided, step-by-step (asks where the inbox goes, optional Telegram bot)
# or: bash install.sh   # non-interactive skeleton only
```

`setup.sh` walks a fresh device through setup in clear stages: it checks
prerequisites, tells you exactly what to install when something is missing,
asks where to put the `inbox/` (inside the repo or on the Desktop), and can
deploy the Telegram bot to a VPS. Preview a run without touching anything:
`MNEMAZINE_SETUP_DRYRUN=1 bash setup.sh`.

After installation, open this folder as an Obsidian vault:

```text
~/Desktop/Mnemazine/vault
```

Everything lives under `~/Desktop/Mnemazine` by default:

- `inbox/` for raw inputs;
- `vault/` for finished knowledge;
- `reports/` for HTML weekly briefings;
- `.mnemazine/` for caches, binaries, and local state;
- `skills/`, `agents/`, `workflows/`, and `scripts/` for the agent system.

## Requirements

- macOS is recommended for Apple Vision OCR.
- Linux works for site parsing, markdown processing, Graphify, and vault operations, but Apple Vision OCR is skipped.
- Node.js 20+.
- Python 3.11+.
- Git.
- Optional: Obsidian, Claude Code, Codex, Cursor, OpenCode, Gemini CLI.

The installer checks what exists and installs what it can safely install locally. It does not require private credentials.

## One-Command Local Run

Put files into:

```text
~/Desktop/Mnemazine/inbox
```

Then run:

```bash
node scripts/mnemazine-run.mjs
```

The run performs:

1. file census;
2. SHA-256 duplicate detection;
3. local extraction when possible;
4. final note creation with `source_ref` and `source_hash`;
5. vault quality gate;
6. archive move only after the quality gate passes;
7. guarded Graphify refresh attempt;
8. weekly HTML report regeneration;
9. report quality gate for the regenerated weekly HTML;
10. action brief at `.mnemazine/state/last-action-brief.md`;
11. visual post-run knowledge report in `reports/`.

The default runner is intentionally conservative. It does not publish data, use private cookies, or send local files to external services. It writes local notes and archives processed source files under `.mnemazine/archive/`.

## Website Ingestion

Mnemazine can ingest a website and convert its useful pages into structured notes:

```bash
node scripts/mnemazine-ingest-site.mjs --url https://example.com --apply --graphify --max-pages 40
```

The parser looks for:

- `robots.txt` sitemap hints;
- `sitemap.xml`;
- same-origin links;
- page titles, descriptions, headings, and main text;
- JSON-LD blocks;
- public API hints inside same-origin JavaScript;
- GitHub links and documentation links.

It does not use private cookies or browser sessions by default. If a site needs authentication, export the data yourself and place it in `inbox/`.

## YouTube Ingestion

Mnemazine can ingest a YouTube channel and turn every video into a transcript note, then keep pulling new uploads automatically:

```bash
python3 scripts/kb-yt-harvest.py "https://www.youtube.com/@SomeChannel" --all --subscribe
```

It pulls subtitles first (near-zero cost) and falls back to local whisper when a video has no usable captions. Each video becomes one inbox note named `yt_<date>_<id>_<title>.md`. A subscribed channel is then polled by `scripts/kb-yt-watch.py` over RSS, harvesting only new uploads — optionally on a daily launchd schedule.

It fetches public videos only and uses no cookies or account sessions by default. See [YouTube Ingestion](docs/youtube-ingestion.md).

## Knowledge Quality Contract

The vault must contain final knowledge, not raw material.

Every finished note should answer:

- What is this?
- Why does it matter?
- How can it be used?
- What are the source links?
- What is verified, assumed, or still unknown?
- Which skills, agents, scripts, or projects can reuse it?

Raw OCR, copied fragments, and messy transcripts are rejected by the quality gate.

The quality gate also rejects common raw-intake residue such as `intake-draft`, `draft-local`, `temp_image_*`, `IMG_*.PNG`, and visible raw image extensions in note content. Graphify output folders and backups are excluded from this note-quality scan.

Run the gate manually:

```bash
node scripts/mnemazine-vault-quality-gate.mjs
```

## Post-Run Knowledge Report

Every finished run can produce a light visual report in Markdown and HTML:

```bash
npm run postrun
```

The report is built for review, not raw logging. It shows:

- what useful knowledge appeared in the vault;
- how notes collapse into clusters and small reusable atoms;
- which duplicates were counted without creating junk notes;
- top-20 recommended actions after the batch.

When no explicit run JSON or logs are passed, the report reads recent vault notes. For exact pipeline runs, pass `--results-json` or `--logs`.

## Agent Skills

The repo includes portable Agent Skills in `.agents/skills` style:

- `skills/mnemazine` — the main knowledge refinery skill;
- `skills/local-doc-ops` — local document/PDF helpers.

The installer can copy them into common agent locations when those tools exist:

- `~/.codex/skills`;
- `~/.claude/skills`;
- project `.agents/skills`.

The skills are public-safe: no personal paths, no private repositories, no account names, no secrets.

## Claude And Codex Parity

Mnemazine is designed so Claude Code and Codex run the same knowledge contract:

- same public scripts in `scripts/`;
- same agent role descriptions in `agents/kb-pipeline/`;
- same `source_ref` / `source_hash` discipline;
- same quality gate before archive;
- same post-run visual report after each full pass.

Agent personalities are part of the workflow, not decoration. They are stored as public-safe role passports so both agents preserve the same responsibilities and tone while avoiding private data.

## Graphify

Graphify turns the vault into a navigable relationship graph. Mnemazine uses it for:

- related-note discovery;
- graph-assisted retrieval;
- weekly change maps;
- finding duplicate or near-duplicate ideas;
- showing how a source affects multiple knowledge areas.

For guarded local refreshes, use:

```bash
export MNEMAZINE_VAULT="/path/to/your/vault"
npm run graph:refresh -- --vault "$MNEMAZINE_VAULT" --mode auto
```

This wrapper keeps `graph.json`, `GRAPH_REPORT.md`, backup/restore, and `needs_update` in sync instead of blindly trusting one heavy semantic run.

For local Ollama semantic refreshes it also uses a guarded model ladder, rejecting models that fail a mini `graphify extract` smoke before they touch the real vault graph. API backends are supported through environment variables such as `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, and `GEMINI_API_KEY`.

Repo defaults live in `config/graphify-refresh.json`. Override them with CLI flags or `MNEMAZINE_GRAPHIFY_*` env vars when needed.

## Weekly HTML Brief

The weekly report is a local HTML presentation in Russian by default. It is meant to be pleasant to read, not a raw log.

Each card can be marked locally:

- `read` — keep in vault;
- `work` — move to action backlog;
- `forget` — remove or quarantine from the active vault.

State is stored in:

```text
~/Desktop/Mnemazine/.mnemazine/state/weekly-state.json
```

## Repository Philosophy

Mnemazine is not a second brain as a storage slogan. It is a memory system as a pipeline:

```text
raw input -> extraction -> understanding -> research -> verification -> atomization -> vault -> graph -> reuse
```

<p align="center">
  <img src="docs/assets/hero/mnemazine-pipeline.png" width="820" alt="The Mnemazine pipeline: raw input, extract, verify, synthesize, vault, graph, reuse">
</p>

That matters because a real memory must be reproducible. A note should be able to become:

- a skill;
- an agent instruction;
- a script;
- a product decision;
- a checklist;
- a weekly action;
- a future prompt with much less context.

## Documentation

- [Installation](docs/installation.md)
- [Architecture](docs/architecture.md)
- [Token Economics](docs/token-economics.md)
- [Website Ingestion](docs/site-ingestion.md)
- [YouTube Ingestion](docs/youtube-ingestion.md)
- [Telegram Intake (bot + Mini App)](docs/telegram-intake.md)
- [Obsidian Vault](docs/obsidian.md)
- [Apple Vision OCR](docs/apple-vision.md)
- [Graphify](docs/graphify.md)
- [Weekly HTML Brief](docs/weekly-html.md)
- [Deep Mode (atomization + verification)](docs/deep-mode.md)

## Safety

This public repository intentionally excludes:

- private vault contents;
- screenshots with personal data;
- API keys;
- SSH hosts;
- account names;
- private project names;
- local absolute paths from the original development machine.

Before publishing a release, run the full local gate:

```bash
npm run release-check
```

It checks script syntax, runs a temporary demo intake, verifies archive-after-quality behavior, runs the demo vault quality gate, scans for private markers/secrets, and checks that the public description and both READMEs stay bilingual.

## License

MIT.
