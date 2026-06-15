# YouTube Ingestion

🇬🇧 **English** · [🇷🇺 Русский](youtube-ingestion.ru.md)

Mnemazine can ingest a YouTube channel and turn every video into a transcript
note in the inbox, then keep pulling new uploads automatically.

Two scripts, both pure CLI (no model tokens spent here):

- `scripts/kb-yt-harvest.py` — backfill a channel (or a single video) now.
- `scripts/kb-yt-watch.py` — poll subscribed channels for new uploads.

## Backfill A Channel

```bash
# newest 50 videos (default cap), and subscribe for future uploads
python3 scripts/kb-yt-harvest.py "https://www.youtube.com/@SomeChannel" --subscribe

# the whole channel
python3 scripts/kb-yt-harvest.py "https://www.youtube.com/@SomeChannel" --all --subscribe

# a single video
python3 scripts/kb-yt-harvest.py "https://www.youtube.com/watch?v=VIDEO_ID"
```

For each video it writes one note to the inbox top level, named
`yt_<upload_date>_<video_id>_<title>.md`, with frontmatter (`source`, `channel`,
`video_id`, `upload_date`, `transcript_method`). The pipeline then studies them
like any other inbox item.

Transcript source, cheapest first:

1. **Subtitles** via yt-dlp (`ru`, `en`; manual preferred over auto) — near-zero cost.
2. **Local whisper** fallback when a video has no usable subtitles.

A per-channel yt-dlp download-archive guarantees each video is harvested once,
whether by backfill or the watch loop.

## Watch For New Uploads

`--subscribe` registers a channel in `.mnemazine/cache/kb-yt/channels.json`.
The watcher reads each channel's RSS feed (last 15 uploads), diffs against the
archive, and harvests only what is new:

```bash
python3 scripts/kb-yt-watch.py --dry-run        # show what would be harvested
python3 scripts/kb-yt-watch.py --harvest-only   # harvest new, do not study
python3 scripts/kb-yt-watch.py                  # harvest new, then study
```

After harvesting, the watcher studies the inbox with
`node scripts/mnemazine-run.mjs` (override with `MNEMAZINE_STUDY_CMD`).

### Daily Schedule (macOS launchd)

Generate a concrete agent from the template (machine paths stay out of the repo):

```bash
sed -e "s#__PYTHON__#$(command -v python3)#g" \
    -e "s#__NODE_BIN__#$(dirname "$(command -v node)")#g" \
    -e "s#__ROOT__#$PWD#g" \
    -e "s#__INBOX__#$PWD/inbox#g" \
    scripts/com.mnemazine.kb-yt-watch.plist.template \
    > ~/Library/LaunchAgents/com.mnemazine.kb-yt-watch.plist
launchctl load ~/Library/LaunchAgents/com.mnemazine.kb-yt-watch.plist
```

It runs daily at 09:00 in `--harvest-only` mode.

## Paths

| What | Where |
|------|-------|
| Notes | `$MNEMAZINE_INBOX` (default `ROOT/inbox`) |
| State (subscriptions, archive) | `ROOT/.mnemazine/cache/kb-yt/` (gitignored) |

Set `MNEMAZINE_INBOX` to point harvested notes at a different inbox.

## Requirements

`yt-dlp`, `ffmpeg`, and `openai-whisper` on `PATH` (`curl` is used for RSS).
See [Installation](installation.md).

## Safety

Only public videos are fetched. Subtitles and metadata are public data. The
default path uses no cookies or account sessions — do not feed private,
age-gated, or members-only content through a knowledge pipeline.

If yt-dlp hits "Sign in to confirm you're not a bot" on some videos, install a
browser-impersonation backend (`yt-dlp` curl_cffi extra); the harvester falls
back to whisper when subtitles cannot be fetched.
