#!/usr/bin/env bash
set -euo pipefail

ROOT="${1:-$(cd "$(dirname "$0")/.." && pwd)}"

# Private markers (machine paths, IPs, personal/project names) that must never ship publicly.
# `root@` requires a real host char after it (lowercase/digit) so the literal
# placeholder `root@YOUR_VPS_HOST` in docs/examples is not a false positive.
PRIVATE_MARKERS='/Users/fil|72\.56|root@[a-z0-9]|Полезные знания|_ВХОДЯЩИЕ|TODOCUPS|ПКК|legal-practice|Adventure Book|AthenaOS|Филипп'
# Token-like values across common providers. Require realistic lengths and a
# non-word boundary before `sk-` to avoid false positives like `risk-or-x`.
# Covers: GitHub OAuth/PAT (gho_/ghp_/ghu_/ghs_/ghr_), OpenAI/Anthropic sk-,
# Slack xox*, AWS access key (AKIA/ASIA), GitLab PAT (glpat-), Google API
# (AIza), JWT (eyJ.header.payload), and PEM private-key blocks.
TOKEN_MARKERS='gh[opusr]_[A-Za-z0-9_]{20,}|(^|[^A-Za-z0-9])sk-[A-Za-z0-9_-]{20,}|xox[baprs]-[A-Za-z0-9-]{20,}|(AKIA|ASIA)[A-Z0-9]{16}|glpat-[A-Za-z0-9_-]{20,}|AIza[A-Za-z0-9_-]{30,}|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}|-----BEGIN [A-Z ]*PRIVATE KEY-----'

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

# Files that could ship publicly: everything git tracks PLUS untracked files
# not covered by .gitignore (a staged-but-uncommitted secret would otherwise
# slip past a tracked-only scan). Ignored runtime noise (.mnemazine, backups)
# is correctly skipped — it never reaches a public push.
tracked_files() {
  local files=()
  while IFS= read -r -d '' file; do
    [ "$file" = "scripts/check-public-release.sh" ] && continue
    files+=("$ROOT/$file")
  done < <(git -C "$ROOT" ls-files -z --cached --others --exclude-standard)
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

# Local extraction cache is gitignored (never shipped), but captured screenshots
# / PDFs can carry credentials that would flow into synthesized notes. Scan it
# for token-like secrets only (personal/Cyrillic text is expected here and fine).
# Token-only, dir-scoped, skipped when the cache does not exist (clean checkout).
scan_dir_tokens() {
  local dir="$1"
  [ -d "$dir" ] || return 1
  if [ "$SCANNER" = "rg" ]; then
    rg -n "$TOKEN_MARKERS" "$dir"
  else
    grep -rEn "$TOKEN_MARKERS" "$dir"
  fi
}

EXTRACTS_DIR="${MNEMAZINE_EXTRACTS:-$ROOT/.mnemazine/cache/extracted}"
status=0
scan_dir_tokens "$EXTRACTS_DIR" || status=$?
if [ "$status" -eq 0 ]; then
  echo "Public release check failed: token-like secret found in extraction cache ($EXTRACTS_DIR)." >&2
  echo "A captured screenshot/PDF likely contains a credential. Remove it before it reaches a note." >&2
  exit 1
elif [ "$status" -ge 2 ]; then
  echo "Public release check errored: scanner '$SCANNER' failed (exit $status) scanning extraction cache." >&2
  exit 1
fi

echo "Public release check passed."
