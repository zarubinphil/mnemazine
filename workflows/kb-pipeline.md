# Mnemazine KB Pipeline

```text
inbox -> census -> extraction -> understanding -> research -> verification -> atomization -> vault -> reconcile -> Graphify -> weekly brief -> visual knowledge report
```

The pipeline is intentionally strict. A source is not done when text is extracted. It is done when a durable note exists or a clear rejection reason is recorded.

## Agents

- Mnemosyne, `kb-coordinator`: owns the full run, handoffs, final brief, and post-run report.
- Ivan Kirilov, `kb-guard`: owns census, source hashes, archive safety, and gates.
- Vasily Sopikov, `kb-extract`: owns local-first extraction and triage.
- Mikhail Lomonosov, `kb-verify`: owns explanation, public verification, and atomization.
- Nikolai Kalachov, `kb-librarian`: owns vault placement, naming, links, and reuse shape.
- Dmitry Mendeleev, `kb-reconciler`: owns coverage accounting: note, duplicate, noise, unreadable, or deferred.

## Required Output

Every useful item must become reproducible knowledge, not a scanned fragment:

- clear Russian title;
- plain explanation of what it is;
- why it matters;
- how to use it;
- what is verified, assumed, or unknown;
- source references with `source_ref` and `source_hash`;
- small atoms when the source contains several ideas;
- next action when the knowledge implies work.

Every full pass must also create a visual post-run report in `reports/`:

- schematic clusters;
- note-to-atom breakdown;
- duplicate accounting;
- top-20 recommended actions.

Claude Code and Codex must follow this same contract. Runtime wrappers may differ, but the public workflow, scripts, gates, and agent role passports are shared.
