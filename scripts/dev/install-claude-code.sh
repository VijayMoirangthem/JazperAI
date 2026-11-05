#!/usr/bin/env bash
# Installs Claude Code into a USER-OWNED npm prefix (no sudo, no root-owned global directories).
# Idempotent: does nothing if the pinned version is already installed. Retries on network failure.
#   CLAUDE_CODE_VERSION  version to install (default pinned below; use "latest" to float)
#   CLAUDE_NPM_PREFIX    install prefix (default ~/.npm-global)
set -euo pipefail

CLAUDE_CODE_VERSION="${CLAUDE_CODE_VERSION:-2.1.318}"
PREFIX="${CLAUDE_NPM_PREFIX:-$HOME/.npm-global}"
BIN="$PREFIX/bin"

command -v npm >/dev/null 2>&1 || { echo "npm not found; install Node first (the devcontainer provides Node 22)." >&2; exit 1; }
mkdir -p "$PREFIX"

installed() { "$BIN/claude" --version 2>/dev/null | awk '{print $1}'; }

if [ -x "$BIN/claude" ] && { [ "$CLAUDE_CODE_VERSION" = "latest" ] || [ "$(installed)" = "$CLAUDE_CODE_VERSION" ]; }; then
  echo "claude code $(installed) already installed in $BIN"
else
  ok=0
  for attempt in 1 2 3; do
    if npm install -g --prefix "$PREFIX" --no-fund --no-audit --loglevel=error "@anthropic-ai/claude-code@${CLAUDE_CODE_VERSION}"; then ok=1; break; fi
    echo "npm install failed (attempt ${attempt}/3); retrying in $((attempt * 5))s" >&2; sleep $((attempt * 5))
  done
  [ "$ok" = 1 ] || { echo "Could not install Claude Code. Re-run: bash scripts/dev/install-claude-code.sh" >&2; exit 1; }
fi

# Put the prefix on PATH for future shells (idempotent), without touching system files.
line="export PATH=\"$BIN:\$PATH\""
for rc in "$HOME/.bashrc" "$HOME/.zshrc"; do
  [ -f "$rc" ] || continue
  grep -qxF "$line" "$rc" || printf '\n# added by scripts/dev/install-claude-code.sh\n%s\n' "$line" >> "$rc"
done

"$BIN/claude" --version
