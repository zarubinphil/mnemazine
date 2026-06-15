# Graphify

Install:

```bash
python3 -m pip install graphifyy
```

Update graph:

```bash
graphify update ~/Desktop/Mnemazine/vault
```

Guarded refresh for Mnemazine nightly/repair runs:

```bash
node scripts/mnemazine-refresh-graphify.mjs --vault "$HOME/Полезные знания" --mode auto --json
```

What helper does:

- runs code-safe `graphify update`;
- detects if semantic freshness is still pending;
- for local Ollama, normalizes base URL to `/v1` before OpenAI-compatible calls;
- smoke-tests candidate models with both chat JSON and mini `graphify extract` before heavy semantic extraction;
- walks a model ladder from `--models` / `MNEMAZINE_GRAPHIFY_MODELS`;
- makes backup of `graphify-out/`;
- restores backup and writes `graphify-out/needs_update` if semantic refresh looks unsafe;
- re-clusters report so `graph.json` and `GRAPH_REPORT.md` stay honest.

Exit codes:

- `0` = graph fresh;
- `2` = partial success, semantic refresh still pending;
- `1` = hard failure.

Graphify helps Mnemazine:

- find related notes;
- detect clusters;
- avoid duplicate concepts;
- build graph-aware context for agents.
