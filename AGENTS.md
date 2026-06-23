# Mnemazine Agent Commands

This repository has two chat commands. Treat them as commands, not as topics to discuss.

## `Mnemazine`

When the latest user message is `Mnemazine`, `Mnemazine inbox`, `Мнемозина`, or `запусти Мнемозину`:

```bash
npm start
```

Run it from the repository root. Do not use `npm run run` for live inbox work. `npm start` is the strict protocol: it must fail before archive if atomization/enrichment did not happen.

## `Mnemazine update`

When the latest user message is `Mnemazine update`, `Мнемозина update`, or `обнови Mnemazine`:

```bash
npm run update
```

This updates code from GitHub, preserves local config, reinstalls wrappers, and syntax-checks scripts. It must not process inbox files.

## Failure Rule

If a command fails, report the failing command and the key error. Do not archive, delete, reset, or rewrite user files.
