#!/usr/bin/env bash
set -euo pipefail

ROOT="${1:-$(cd "$(dirname "$0")/.." && pwd)}"

# Private markers (machine paths, IPs, personal/project names) that must never ship publicly.
PRIVATE_MARKERS='/Users/fil|72\.56|root@|Полезные знания|_ВХОДЯЩИЕ|TODOCUPS|ПКК|legal-practice|Adventure Book|AthenaOS|Филипп'
# Token-like values (GitHub OAuth, OpenAI/Anthropic-style sk-, Slack xox*).
# Require realistic lengths and a non-word boundary before `sk-` to avoid
# false positives such as `risk-or-verification`.
TOKEN_MARKERS='gho_[A-Za-z0-9_]{20,}|(^|[^A-Za-z0-9])sk-[A-Za-z0-9_-]{20,}|xox[baprs]-[A-Za-z0-9-]{20,}'

# Pick a scanner. Prefer ripgrep; fall back to POSIX grep so the gate still runs
# on machines without rg. A missing scanner must HARD-FAIL, never silently pass.
if command -v rg >/dev/null 2>&1; then
  SCANNER="rg"
elif command -v grep >/dev/null 2>&1; then
  SCANNER="grep"
else
  echo "Public release check errored: neither 'rg' nor 'grep' is available to scan." >&2
  exit 1
fi

TRACKED_ONLY=0
if git -C "$ROOT" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  TRACKED_ONLY=1
fi

tracked_files() {
  local files=()
  while IFS= read -r -d '' file; do
    [ "$file" = "scripts/check-public-release.sh" ] && continue
    files+=("$ROOT/$file")
  done < <(git -C "$ROOT" ls-files -z)
  printf '%s\0' "${files[@]}"
}

# scan PATTERN: print matches under $ROOT, excluding vendored/VCS noise and this
# script itself (it embeds the marker patterns). Exit: 0 = match, 1 = clean, >=2 = scanner error.
scan() {
  local pattern="$1"
  if [ "$TRACKED_ONLY" -eq 1 ]; then
    local files=()
    while IFS= read -r -d '' file; do
      files+=("$file")
    done < <(tracked_files)
    if [ "${#files[@]}" -eq 0 ]; then
      return 1
    fi
    if [ "$SCANNER" = "rg" ]; then
      rg -n "$pattern" "${files[@]}"
    else
      grep -En "$pattern" "${files[@]}"
    fi
  elif [ "$SCANNER" = "rg" ]; then
    rg -n "$pattern" "$ROOT" \
      -g '!node_modules/**' -g '!.git/**' -g '!scripts/check-public-release.sh'
  else
    grep -rEn "$pattern" "$ROOT" \
      --exclude-dir=node_modules --exclude-dir=.git --exclude=check-public-release.sh
  fi
}

# check PATTERN LABEL: fail on a match; also fail (never pass) if the scanner
# itself errors — a security gate must never read a tooling failure as green.
check() {
  local pattern="$1"
  local label="$2"
  local status=0
  scan "$pattern" || status=$?
  if [ "$status" -eq 0 ]; then
    echo "Public release check failed: $label found." >&2
    exit 1
  elif [ "$status" -ge 2 ]; then
    echo "Public release check errored: scanner '$SCANNER' failed (exit $status) while checking $label." >&2
    exit 1
  fi
}

check "$PRIVATE_MARKERS" "private marker"
check "$TOKEN_MARKERS" "token-like value"

echo "Public release check passed."
