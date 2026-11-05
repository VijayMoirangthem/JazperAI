#!/usr/bin/env bash
# Runs once when the dev container is created. Deliberately light and NEVER fails the container build: a flaky network
# must not leave Codespaces in recovery mode. Each step is idempotent and can be re-run by hand.
# Heavy work (Python deps, migrations) is NOT done here; run ./scripts/dev/bootstrap.sh afterwards.
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1

failed=()
step() {
  local name="$1"; shift
  echo "==> ${name}"
  if "$@"; then echo "    ok"; else echo "    WARN: ${name} failed; continuing (re-run: $*)" >&2; failed+=("${name}"); fi
}

step "git safe.directory" git config --global --add safe.directory "$PWD"
step "doppler cli" bash .devcontainer/install-doppler.sh
step "claude code" bash scripts/dev/install-claude-code.sh

echo
if [ "${#failed[@]}" -gt 0 ]; then echo "Some optional steps failed: ${failed[*]} (see messages above)."; fi
echo "Next: ./scripts/dev/bootstrap.sh   (docs/CLOUD_DEV.md)"
exit 0
