#!/usr/bin/env bash
# Daily: pull buffered Telegram messages from the VPS into the local inbox,
# then run the Mnemazine protocol. Mac initiates (VPS can't reach Mac behind NAT).
# ponytail: rsync --remove-source-files = move; local protocol archives originals,
#           so the VPS stays a thin transit buffer, not a second store.
set -euo pipefail

REPO="${MNEMAZINE_ROOT:-$HOME/Проекты/mnemazine}"
VPS="${MNEMAZINE_VPS:-root@YOUR_VPS_HOST}"
KEY="${MNEMAZINE_VPS_KEY:-$HOME/.ssh/id_rsa}"
REMOTE_INBOX="${MNEMAZINE_REMOTE_INBOX:-/var/www/mnemazine-inbox/}"
LOCAL_INBOX="$REPO/inbox/"

mkdir -p "$LOCAL_INBOX"

# Pull + remove transferred files from VPS. Keep the bot's offset/dotfiles on VPS.
rsync -avz --remove-source-files --exclude '.*' \
  -e "ssh -i $KEY -o StrictHostKeyChecking=no" \
  "$VPS:$REMOTE_INBOX" "$LOCAL_INBOX"

cd "$REPO"
npm run run
