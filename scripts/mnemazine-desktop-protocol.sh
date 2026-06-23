#!/usr/bin/env bash
set -euo pipefail

REPO="${MNEMAZINE_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
ENV_INBOX="${MNEMAZINE_INBOX:-}"
ENV_VAULT="${MNEMAZINE_VAULT:-}"
ENV_DEEP="${MNEMAZINE_DEEP:-}"
ENV_REQUIRE_DEEP="${MNEMAZINE_REQUIRE_DEEP:-}"

[ -f "$REPO/.mnemazine/config.env" ] && . "$REPO/.mnemazine/config.env"
[ -f "$REPO/.mnemazine/config.local.sh" ] && . "$REPO/.mnemazine/config.local.sh"

export MNEMAZINE_ROOT="$REPO"
BASE_INBOX="${ENV_INBOX:-${MNEMAZINE_INBOX:-$HOME/Desktop/Mnemazine Inbox}}"
export MNEMAZINE_VAULT="${ENV_VAULT:-${MNEMAZINE_VAULT:-$HOME/Мозг}}"
export MNEMAZINE_DEEP="${ENV_DEEP:-${MNEMAZINE_DEEP:-1}}"
export MNEMAZINE_REQUIRE_DEEP="${ENV_REQUIRE_DEEP:-${MNEMAZINE_REQUIRE_DEEP:-1}}"

active_count() {
  find "$1" -maxdepth 1 -type f ! -name '.*' 2>/dev/null | wc -l | tr -d ' '
}

run_inbox() {
  local inbox="$1"
  local count
  count="$(active_count "$inbox")"
  [ "$count" = "0" ] && return 0
  echo "Mnemazine protocol: $inbox ($count files)" >&2
  ran=1
  MNEMAZINE_INBOX="${inbox%/}" npm run run -- --deep --require-deep
}

mkdir -p "$BASE_INBOX" "$MNEMAZINE_VAULT"
ran=0

run_inbox "$BASE_INBOX"

# Historical Telegram sync bug could create a nested inbox. Keep this guard so
# old leftovers do not silently sit outside the active top-level scan.
NESTED="$BASE_INBOX/mnemazine-inbox"
if [ -d "$NESTED" ]; then
  run_inbox "$NESTED"
fi

if [ "$ran" = "0" ]; then
  echo "Mnemazine protocol: no active inbox files" >&2
  exit 0
fi

MNEMAZINE_INBOX="${BASE_INBOX%/}" npm run complete -- --require-deep
