# Mnemazine

<p align="center">
  <img src="docs/assets/logo/mnemazine-logo.png" width="240" alt="Mnemazine logo: Mnemosyne as a memory spiral and knowledge graph">
</p>

**Mnemazine** is an open-source personal knowledge system inspired by **Mnemosyne**, the Greek goddess of memory. The name is intentionally brandable, while the idea is classical: memory is not a dump of files. Memory is formed when raw experience is recognized, checked, connected, rewritten, and made reusable.

Mnemazine turns screenshots, PDFs, web pages, videos, notes, guides, GitHub repositories, and random fragments into a clean Obsidian-compatible knowledge base.

![Mnemazine pipeline](docs/assets/screenshots/01-inbox-to-knowledge.svg)

## What It Is

Mnemazine is a local-first knowledge refinery.

It does not save raw OCR into your vault. It does not keep vague summaries that are impossible to reuse. It tries to produce finished knowledge:

- clear notes with understandable titles;
- source links and verification status;
- topic-based atomization when one source contains many ideas;
- reusable skill descriptions, agent instructions, implementation notes, and project actions;
- Graphify maps for semantic navigation;
- weekly HTML briefings with local state: `read`, `work on it`, `forget`.

The goal is simple: future you should not reread twenty screenshots, a whole guide, or a messy transcript. Future you should open one good note and immediately understand what the knowledge is, why it matters, how to use it, and what evidence supports it.

## Why It Saves Tokens

Mnemazine saves tokens by moving work out of repeated LLM context and into durable local structure.

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
git clone https://github.com/7teenno1-art/Mnemazine.git "$HOME/Desktop/Mnemazine"
cd "$HOME/Desktop/Mnemazine"
bash install.sh
```

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
4. topic splitting;
5. source-aware note creation;
6. vault quality gate;
7. Graphify update when available;
8. weekly HTML report update.

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

![Site ingestion](docs/assets/screenshots/04-site-ingestion.svg)

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

Run the gate manually:

```bash
node scripts/mnemazine-vault-quality-gate.mjs
```

## Agent Skills

The repo includes portable Agent Skills in `.agents/skills` style:

- `skills/mnemazine` — the main knowledge refinery skill;
- `skills/local-doc-ops` — local document/PDF helpers.

The installer can copy them into common agent locations when those tools exist:

- `~/.codex/skills`;
- `~/.claude/skills`;
- project `.agents/skills`.

The skills are public-safe: no personal paths, no private repositories, no account names, no secrets.

## Graphify

Graphify turns the vault into a navigable relationship graph. Mnemazine uses it for:

- related-note discovery;
- graph-assisted retrieval;
- weekly change maps;
- finding duplicate or near-duplicate ideas;
- showing how a source affects multiple knowledge areas.

![Graphify map](docs/assets/screenshots/03-graphify-map.svg)

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

![Weekly HTML report](docs/assets/screenshots/02-weekly-html-report.svg)

## Repository Philosophy

Mnemazine is not a second brain as a storage slogan. It is a memory system as a pipeline:

```text
raw input -> extraction -> understanding -> research -> verification -> atomization -> vault -> graph -> reuse
```

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
- [Obsidian Vault](docs/obsidian.md)
- [Apple Vision OCR](docs/apple-vision.md)
- [Graphify](docs/graphify.md)
- [Weekly HTML Brief](docs/weekly-html.md)

## Safety

This public repository intentionally excludes:

- private vault contents;
- screenshots with personal data;
- API keys;
- SSH hosts;
- account names;
- private project names;
- local absolute paths from the original development machine.

## License

MIT.
