#!/usr/bin/env bash
# Runs every ~5 min via launchd. Decides whether to run the Mnemazine protocol:
#   - manual: mini app touched .run-now on the VPS (consumed atomically here)
#   - daily:  first eligible tick at/after 09:00 local that hasn't run today
# Reverse channel VPS->Mac without a public Mac: Mac polls a flag the VPS sets.
set -euo pipefail

REPO="${MNEMAZINE_ROOT:-$HOME/Проекты/mnemazine}"
VPS="${MNEMAZINE_VPS:-root@YOUR_VPS_HOST}"
KEY="${MNEMAZINE_VPS_KEY:-$HOME/.ssh/id_rsa}"
REMOTE_INBOX="${MNEMAZINE_REMOTE_INBOX:-/var/www/mnemazine-inbox}"
SSH="ssh -i $KEY -o StrictHostKeyChecking=no -o ConnectTimeout=10"
MARKER="$REPO/.mnemazine/.last-daily"

run=0
# Consume run-now flag atomically: print + delete in one ssh.
flag="$($SSH "$VPS" "f=$REMOTE_INBOX/.run-now; if [ -f \"\$f\" ]; then cat \"\$f\"; rm -f \"\$f\"; fi" 2>/dev/null || true)"
[ -n "$flag" ] && run=1

today="$(date +%F)"
if [ "$(cat "$MARKER" 2>/dev/null || true)" != "$today" ] && [ "$(date +%H)" -ge 9 ]; then run=1; fi

[ "$run" -eq 0 ] && exit 0

bash "$REPO/scripts/mnemazine-telegram-sync.sh"

mkdir -p "$(dirname "$MARKER")"; echo "$today" > "$MARKER"
$SSH "$VPS" "echo $(date -u +%FT%TZ) > $REMOTE_INBOX/.last-run" 2>/dev/null || true
