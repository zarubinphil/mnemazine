#!/usr/bin/env bash
# Runs every ~5 min via launchd. Decides whether to run the Mnemazine protocol:
#   - manual: mini app touched .run-now on the VPS (consumed atomically here)
#   - daily:  first eligible tick at/after 09:00 local that hasn't run today
# Reverse channel VPS->Mac without a public Mac: Mac polls a flag the VPS sets.
set -euo pipefail

REPO="${MNEMAZINE_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
# Live host/key/paths live in a gitignored config, never hardcoded here.
[ -f "$REPO/.mnemazine/config.env" ] && . "$REPO/.mnemazine/config.env"
VPS="${MNEMAZINE_VPS:-root@YOUR_VPS_HOST}"
KEY="${MNEMAZINE_VPS_KEY:-$HOME/.ssh/id_rsa}"
REMOTE_INBOX="${MNEMAZINE_REMOTE_INBOX:-/var/www/mnemazine-inbox}"

# ponytail: fail fast if still on the placeholder — beats a confusing ssh error.
if [ "$VPS" = "root@YOUR_VPS_HOST" ]; then
  echo "Set MNEMAZINE_VPS (and MNEMAZINE_VPS_KEY) in $REPO/.mnemazine/config.env" >&2
  exit 1
fi
SSH="ssh -i $KEY -o StrictHostKeyChecking=no -o ConnectTimeout=10"
MARKER="$REPO/.mnemazine/.last-daily"
mkdir -p "$REPO/.mnemazine"

# Single-flight lock. macOS has no flock, so use an atomic mkdir lock dir.
# Steal a stale lock (>60 min) left by a killed run.
LOCK="$REPO/.mnemazine/poll.lock"
[ -d "$LOCK" ] && find "$LOCK" -maxdepth 0 -mmin +60 -exec rmdir {} \; 2>/dev/null
if ! mkdir "$LOCK" 2>/dev/null; then exit 0; fi   # previous tick still running
trap 'rmdir "$LOCK" 2>/dev/null' EXIT

run=0; manual=0
# Consume run-now flag atomically: print + delete in one ssh.
flag="$($SSH "$VPS" "f=$REMOTE_INBOX/.run-now; if [ -f \"\$f\" ]; then cat \"\$f\"; rm -f \"\$f\"; fi" 2>/dev/null || true)"
[ -n "$flag" ] && { run=1; manual=1; }

today="$(date +%F)"
if [ "$(cat "$MARKER" 2>/dev/null || true)" != "$today" ] && [ "$(date +%H)" -ge 9 ]; then
  run=1
  # Mark the daily attempt BEFORE syncing: a failed run must not re-fire every
  # 5 min for the rest of the day (storm). One attempt per day.
  echo "$today" > "$MARKER"
fi

[ "$run" -eq 0 ] && exit 0

if bash "$REPO/scripts/mnemazine-telegram-sync.sh"; then
  $SSH "$VPS" "echo $(date -u +%FT%TZ) > $REMOTE_INBOX/.last-run" 2>/dev/null || true
else
  # A manual run-now we already consumed shouldn't vanish on failure — re-queue it.
  [ "$manual" = "1" ] && $SSH "$VPS" "echo retry > $REMOTE_INBOX/.run-now" 2>/dev/null || true
  exit 1
fi
