#!/usr/bin/env bash
set -euo pipefail

# Default to where this script lives (the clone), not a hardcoded path.
ROOT="${MNEMAZINE_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)}"
INBOX="${MNEMAZINE_INBOX:-$ROOT/inbox}"
VAULT="${MNEMAZINE_VAULT:-$ROOT/vault}"
REPORTS="${MNEMAZINE_REPORTS:-$ROOT/reports}"
STATE="${MNEMAZINE_STATE:-$ROOT/.mnemazine/state}"
BIN="$ROOT/.mnemazine/bin"

mkdir -p "$INBOX" "$VAULT" "$REPORTS" "$STATE" "$BIN" "$ROOT/.mnemazine/cache"
mkdir -p "$VAULT/00 System" "$VAULT/01 Concepts" "$VAULT/02 Tools" "$VAULT/03 Agents" "$VAULT/04 Projects" "$VAULT/99 Archive"

if command -v python3 >/dev/null 2>&1; then
  python3 -m venv "$ROOT/.venv" || true
  "$ROOT/.venv/bin/python" -m pip install --upgrade pip
  "$ROOT/.venv/bin/python" -m pip install -r "$ROOT/requirements.txt" || true
fi

if command -v swiftc >/dev/null 2>&1 && [ -f "$ROOT/skills/mnemazine/vision-ocr.swift" ]; then
  swiftc -O "$ROOT/skills/mnemazine/vision-ocr.swift" -o "$BIN/vision-ocr" || true
fi

if [ -d "$HOME/.codex/skills" ]; then
  mkdir -p "$HOME/.codex/skills"
  cp -R "$ROOT/skills/mnemazine" "$HOME/.codex/skills/" 2>/dev/null || true
  cp -R "$ROOT/skills/local-doc-ops" "$HOME/.codex/skills/" 2>/dev/null || true
fi

if [ -d "$HOME/.claude/skills" ]; then
  mkdir -p "$HOME/.claude/skills"
  cp -R "$ROOT/skills/mnemazine" "$HOME/.claude/skills/" 2>/dev/null || true
  cp -R "$ROOT/skills/local-doc-ops" "$HOME/.claude/skills/" 2>/dev/null || true
fi

cat > "$VAULT/00 System/Mnemazine Protocol.md" <<'EOF'
# Mnemazine Protocol

The vault contains finished knowledge only.

Raw OCR, copied fragments, transcripts, screenshots, and unverified dumps stay in `inbox/`, `.mnemazine/cache/`, or `99 Archive/`.

Every durable note should contain:

- clear title;
- short explanation;
- source links;
- verified facts;
- open questions;
- practical use;
- related notes.
EOF

cat > "$ROOT/.mnemazine/config.json" <<EOF
{
  "root": "$ROOT",
  "inbox": "$INBOX",
  "vault": "$VAULT",
  "reports": "$REPORTS",
  "state": "$STATE",
  "ocr": "$BIN/vision-ocr"
}
EOF

echo "Mnemazine installed."
echo "Root: $ROOT"
echo "Inbox: $INBOX"
echo "Vault: $VAULT"
echo "Open the vault folder in Obsidian."

# Greet only when run directly. Under setup.sh this is a mid-flow sub-step;
# setup.sh prints the greeting itself at its true end so it is not buried.
[ "${MNEMAZINE_FROM_SETUP:-0}" = "1" ] || bash "$ROOT/scripts/hello.sh"
