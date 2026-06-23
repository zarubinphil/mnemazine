---
name: mnemazine
description: Use when turning raw files, links, screenshots, transcripts, PDFs, guides, or repositories into verified reusable knowledge for an Obsidian-compatible vault.
---

# Mnemazine

Mnemazine is a knowledge refinery skill.

Use it when the user gives raw material and wants it preserved as durable knowledge, not as a dump.

## Chat Shortcut

If the user says `Mnemazine inbox`, `Мнемозина, inbox`, or `запусти Мнемозину`, run:

```bash
npm start
```

For live inbox work, do not use `npm run run`. `npm start` runs the strict desktop protocol and fails before archive if deep atomization/enrichment did not happen.

## Contract

The vault stores final knowledge only.

Do not write raw OCR, copied fragments, noisy transcripts, or unverified paste dumps directly into the vault.

## Workflow

1. Identify what the source is: screenshot, PDF, site, code repo, video, transcript, guide, or inline text.
2. Extract locally when possible: text parser, PDF parser, Apple Vision OCR, or transcription.
3. Understand the topic before writing.
4. Research public sources when the claim depends on current or external facts.
5. Split one source into multiple notes when it contains multiple unrelated ideas.
6. Write clear notes with source links, verification status, practical use, and related concepts.
7. Run the vault quality gate.
8. Update Graphify when available.
9. Produce a short action brief when the new knowledge implies work.
10. Produce a visual post-run knowledge report with clusters, atoms, duplicates, and top-20 actions.

YouTube channels can be auto-harvested into the inbox as transcript notes (`docs/youtube-ingestion.md`); they then flow through this same workflow.

## Note Shape

Every durable note should contain:

- Russian title when the user's working language is Russian;
- `What This Is`;
- `Why It Matters`;
- `How To Use It`;
- `Source`;
- `Verification`;
- `Atomization` when the source contains several ideas;
- `Related Notes`;
- `Reuse`.

Use `source_ref` and `source_hash` for local files. Do not expose raw private filenames when a stable local-media reference is enough.

## Agent Parity

Claude Code and Codex must use the same knowledge contract:

- same scripts;
- same gates;
- same note shape;
- same post-run visual report;
- same public-safe agent role passports.

## Local Paths

Use environment variables:

- `MNEMAZINE_ROOT`;
- `MNEMAZINE_INBOX`;
- `MNEMAZINE_VAULT`;
- `MNEMAZINE_REPORTS`;
- `MNEMAZINE_STATE`.

Never assume a specific username, home path, private project, SSH host, or API key.
