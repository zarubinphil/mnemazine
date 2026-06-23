#!/usr/bin/env bash
# Daily: pull buffered Telegram messages from the VPS into the local inbox,
# then run the Mnemazine protocol. Mac initiates (VPS can't reach Mac behind NAT).
# ponytail: rsync --remove-source-files = move; local protocol archives originals,
#           so the VPS stays a thin transit buffer, not a second store.
set -euo pipefail

REPO="${MNEMAZINE_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
# Live host/key/paths live in a gitignored config, never hardcoded here.
[ -f "$REPO/.mnemazine/config.env" ] && . "$REPO/.mnemazine/config.env"
# Non-secret personal overrides (e.g. MNEMAZINE_INBOX), gitignored.
[ -f "$REPO/.mnemazine/config.local.sh" ] && . "$REPO/.mnemazine/config.local.sh"
VPS="${MNEMAZINE_VPS:-root@YOUR_VPS_HOST}"
KEY="${MNEMAZINE_VPS_KEY:-$HOME/.ssh/id_rsa}"
REMOTE_INBOX="${MNEMAZINE_REMOTE_INBOX:-/var/www/mnemazine-inbox/}"
REMOTE_INBOX="${REMOTE_INBOX%/}/"
# Inbox honours MNEMAZINE_INBOX (from config.env); defaults to repo-local inbox.
LOCAL_INBOX="${MNEMAZINE_INBOX:-$REPO/inbox}"
LOCAL_INBOX="${LOCAL_INBOX%/}/"
STAGING="${LOCAL_INBOX}.staging/"
# Export so the protocol runner reads the same inbox.
export MNEMAZINE_INBOX="${LOCAL_INBOX%/}"

if [ "$VPS" = "root@YOUR_VPS_HOST" ]; then
  echo "Set MNEMAZINE_VPS (and MNEMAZINE_VPS_KEY) in $REPO/.mnemazine/config.env" >&2
  exit 1
fi

mkdir -p "$LOCAL_INBOX" "$STAGING"
SSH_E="ssh -i $KEY -o StrictHostKeyChecking=no"

# Two-phase move (C2: never delete the only copy before processing succeeds).
# 1) pull into staging WITHOUT deleting on the VPS, resumable on partial transfer.
rsync -avz --partial --exclude '.*' -e "$SSH_E" "$VPS:$REMOTE_INBOX" "$STAGING"

# 2) promote staged files into the live inbox (atomic rename, same filesystem).
#    Record exactly which files we took, so we delete only those on the VPS later
#    (messages that arrive during the run stay buffered, not deleted).
pulled=()
shopt -s dotglob nullglob
for f in "$STAGING"*; do
  base="$(basename "$f")"
  case "$base" in .*) continue ;; esac   # skip dotfiles defensively
  mv -f "$f" "$LOCAL_INBOX$base"
  pulled+=("$base")
done
shopt -u dotglob nullglob

# 3) run the protocol; only AFTER it succeeds delete the taken files on the VPS.
cd "$REPO"
if npm run protocol:desktop; then
  if [ "${#pulled[@]}" -gt 0 ]; then
    printf '%s\n' "${pulled[@]}" | $SSH_E "$VPS" "cd ${REMOTE_INBOX%/} && xargs -d '\n' -r rm -f --"
  fi
else
  echo "protocol run failed — files are in local inbox, VPS copies kept for safety" >&2
  exit 1
fi
