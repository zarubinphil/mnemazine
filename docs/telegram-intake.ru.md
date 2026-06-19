# Приём через Telegram (бот + Mini App)

Шлёшь что угодно в Telegram-бота — текст, фото, документ, голос, аудио, видео —
и оно попадает в `inbox/` Mnemazine. Маленькая Mini App показывает буфер,
даёт быстро бросить заметку и запустить прогон протокола по требованию.
Ежедневный авто-прогон работает как и раньше.

Сам протокол идёт **на твоей машине** (локальные OCR-движки, локальный
LLM-бинарь). Бот живёт на всегда-онлайн хосте, чтобы принимать пока машина
спит; машина сама забирает буфер и обрабатывает. Хост — только транзитный
буфер, не второе хранилище.

## Архитектура

```
  Telegram ──сообщение──▶ Бот (всегда-онлайн хост)
                            │ long-poll getUpdates (без webhook/TLS)
                            ▼
                    staging-inbox хоста  ◀── Mini App: POST /api/send
                            │                Mini App: POST /api/run → флаг .run-now
                            │
        твоя машина ────────┤ pull, каждые ~5 мин:
                            │   • есть флаг .run-now?   → прогон
                            │   • наступило окно дня?   → прогон
                            ▼
                  rsync --remove-source-files  (move; хост остаётся тонким)
                            ▼
                    локальный inbox/  ──▶  npm run run  (протокол)
                            ▼
                          vault/      ──пишет .last-run──▶ статус Mini App
```

Обратный канал без публичной машины: хост не достучится до машины. Машина
сама поллит флаг, который ставит хост. Кнопка «Прогнать сейчас» в Mini App
просто пишет флаг; ближайший poll его забирает.

## Компоненты

| Часть | Где | Что |
|---|---|---|
| `scripts/mnemazine-telegram-bot.mjs` | хост | Long-poll бот. Пишет каждое сообщение в staging-inbox. Ноль зависимостей. |
| `scripts/mnemazine-webapp-server.mjs` | хост | API Mini App (`/api/status`, `/api/send`, `/api/run`). Верифицирует `initData`, держит allowlist. Ноль зависимостей. |
| `webapp/index.html` | хост (статика) | UI Mini App. Тема-aware, один файл. |
| `scripts/mnemazine-telegram-poll.sh` | твоя машина | Тик ~5 мин: флаг run-now / дневное окно → pull + прогон. |
| `scripts/mnemazine-telegram-sync.sh` | твоя машина | rsync pull (move) + `npm run run`. |
| `scripts/com.mnemazine.telegram-sync.plist.template` | твоя машина | launchd-агент (macOS) для тика. |

## Установка

### 1. Бот на хосте

```bash
TELEGRAM_BOT_TOKEN=<от @BotFather> \
MNEMAZINE_INBOX=/path/to/staging-inbox \
node scripts/mnemazine-telegram-bot.mjs
```

Первое сообщение логирует твой `chat_id`. Закрой бота на себя:

```bash
ALLOWED_CHAT_IDS=<твой_chat_id>   # через запятую для нескольких
```

Перезапусти с этим env. Пусто = bootstrap-режим (принимает, логирует id для настройки).

### 2. Mini App на хосте

Раздавай `webapp/index.html` по **HTTPS** (Telegram требует TLS) и проксируй
`/api/` на API-сервер:

```bash
TELEGRAM_BOT_TOKEN=<токен> \
MNEMAZINE_INBOX=/path/to/staging-inbox \
ALLOWED_CHAT_IDS=<твой_chat_id> \
PORT=8787 \
node scripts/mnemazine-webapp-server.mjs
```

Пример reverse-proxy (любой TLS-фронт подойдёт):

```nginx
location /mini/mnemazine/api/ { proxy_pass http://127.0.0.1:8787/api/; }
location /mini/mnemazine/     { alias /path/to/webapp/; index index.html; }
```

Страница тянет `api/...` относительно своего пути — работает под любым
суб-путём. Наведи кнопку-меню бота на URL страницы:

```bash
curl -X POST "https://api.telegram.org/bot<токен>/setChatMenuButton" \
  -H 'content-type: application/json' \
  -d '{"menu_button":{"type":"web_app","text":"Mnemazine",
       "web_app":{"url":"https://<твой-хост>/mini/mnemazine/"}}}'
```

### 3. Поллер на твоей машине

```bash
# отрендерить launchd-шаблон и загрузить (macOS)
sed 's#__REPO__#'"$PWD"'#g' \
  scripts/com.mnemazine.telegram-sync.plist.template \
  > ~/Library/LaunchAgents/com.mnemazine.telegram-sync.plist
launchctl load ~/Library/LaunchAgents/com.mnemazine.telegram-sync.plist
```

Хост/ключ/пути переопределяются через `MNEMAZINE_VPS`, `MNEMAZINE_VPS_KEY`,
`MNEMAZINE_REMOTE_INBOX`, `MNEMAZINE_ROOT` (см. шапки скриптов). На Linux —
cron на 5 минут, вызывающий `mnemazine-telegram-poll.sh`.

## Безопасность

- Токен — секрет: env / секрет-стор, никогда не в git.
- `initData` HMAC-верифицируется токеном бота; проходят только id из allowlist.
- Бот игнорирует сообщения от всех вне `ALLOWED_CHAT_IDS`.

## Селф-тесты

```bash
node scripts/mnemazine-telegram-bot.mjs --selftest
node scripts/mnemazine-webapp-server.mjs --selftest
```
