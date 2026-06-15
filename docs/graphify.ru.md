# Graphify

🇷🇺 **Русский** · [🇬🇧 English](graphify.md)

Установка:

```bash
python3 -m pip install graphifyy
```

Обновить граф:

```bash
graphify update ~/Desktop/Mnemazine/vault
```

Защищённое обновление для ночных/ремонтных прогонов Mnemazine:

```bash
export MNEMAZINE_VAULT="/path/to/your/vault"
node scripts/mnemazine-refresh-graphify.mjs --vault "$MNEMAZINE_VAULT" --mode auto --json
```

Что делает обёртка:

- запускает code-safe `graphify update`;
- определяет, осталась ли семантическая свежесть в ожидании;
- для локального Ollama нормализует базовый URL до `/v1` перед OpenAI-совместимыми вызовами;
- смоук-тестит кандидатные модели и chat-JSON, и мини `graphify extract` до тяжёлой семантической экстракции;
- проходит лестницу моделей из `--models` / `MNEMAZINE_GRAPHIFY_MODELS`;
- делает бэкап `graphify-out/`;
- восстанавливает бэкап и пишет `graphify-out/needs_update`, если семантическое обновление выглядит небезопасным;
- перекластеризует отчёт, чтобы `graph.json` и `GRAPH_REPORT.md` оставались честными.

Коды выхода:

- `0` = граф свежий;
- `2` = частичный успех, семантическое обновление ещё в ожидании;
- `1` = жёсткий сбой.

Дефолты лежат в `config/graphify-refresh.json`.

Смоук-тест:

```bash
npm run graph:smoke
```

Graphify помогает Mnemazine:

- находить связанные заметки;
- выявлять кластеры;
- избегать дублирующихся концепций;
- строить граф-осведомлённый контекст для агентов.
