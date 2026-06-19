#!/usr/bin/env bash
set -euo pipefail

ROOT="${MNEMAZINE_ROOT:-$HOME/Проекты/mnemazine}"
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

cat <<'EOF'

────────────────────────────────────────────────────────────
Привет! Это Philipp — автор Мнемазины.

Спасибо, что ставите мою разработку. Я делал её, чтобы сырьё
превращалось в проверенное, готовое к работе знание — и рад,
что теперь она будет помогать и вам.

★ Если зашло — поставьте звезду на GitHub, мне это правда важно:
  https://github.com/zarubinphil/Mnemazine
💡 Есть идея, как сделать лучше? Откройте issue или PR —
   предлагайте улучшения, я читаю каждое.

— — —

Hi! This is Philipp — the author of Mnemazine.

Thank you for installing my project. I built it to turn raw
input into verified, ready-to-use knowledge — glad it will now
help you too.

★ If you like it, please star it on GitHub — it truly helps:
  https://github.com/zarubinphil/Mnemazine
💡 Got an idea to make it better? Open an issue or PR —
   improvements are always welcome, I read every one.
────────────────────────────────────────────────────────────
EOF
