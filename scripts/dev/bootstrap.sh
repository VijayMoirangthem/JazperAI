#!/usr/bin/env bash
# One-command development bootstrap (Codespaces, local dev container, Linux/macOS, CI).
#   ./scripts/dev/bootstrap.sh [--full] [--frontend] [--start] [--no-compose] [--check]
#
#   (default)    backend venv + light deps, Postgres/Redis up, migrations, connectivity check
#   --full       also install the heavy optional ML deps (sentence-transformers/torch, faster-whisper, playwright)
#   --frontend   also `npm ci` in app/ (the Vite renderer)
#   --start      start the API on :8000 afterwards (through Doppler when DOPPLER_TOKEN is set)
#   --no-compose do not try to start Postgres/Redis with Docker (use whatever POSTGRES_*/REDIS_* point to)
#   --check      verify only: report what is installed/reachable and change nothing
#
# Idempotent (safe to re-run), retries network steps, never prints secret values. See docs/CLOUD_DEV.md.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BACKEND="$ROOT/backend/python"
VENV="$ROOT/backend/.venv-linux"
COMPOSE_FILE="$ROOT/.devcontainer/docker-compose.yml"
FULL=0; FRONTEND=0; START=0; COMPOSE=1; CHECK=0
for a in "$@"; do
  case "$a" in
    --full) FULL=1 ;; --frontend) FRONTEND=1 ;; --start) START=1 ;; --no-compose) COMPOSE=0 ;; --check) CHECK=1 ;;
    -h|--help) sed -n '2,12p' "${BASH_SOURCE[0]}"; exit 0 ;;
    *) echo "unknown option: $a (try --help)" >&2; exit 2 ;;
  esac
done

t0=$(date +%s)
log() { printf '\n==> %s\n' "$*"; }
retry() { local n=0; until "$@"; do n=$((n + 1)); [ "$n" -ge 3 ] && return 1; echo "   retry $n/3 in $((n * 5))s: $*" >&2; sleep $((n * 5)); done; }

# --- connection settings (shared with your shell via: source scripts/dev/env.sh) ---------------------------------------
# shellcheck source=scripts/dev/env.sh
source "$ROOT/scripts/dev/env.sh"

py_probe() { # exit 0 when Postgres AND Redis answer; uses only the stdlib so it works before deps are installed
  python3 - <<'PY'
import os, socket, sys
def up(h, p):
    try: socket.create_connection((h, int(p)), 2).close(); return True
    except OSError: return False
sys.exit(0 if up(os.environ["POSTGRES_HOST"], os.environ["POSTGRES_PORT"]) and up(os.environ["REDIS_HOST"], os.environ["REDIS_PORT"]) else 1)
PY
}

if [ "$CHECK" = 1 ]; then
  log "check only (nothing is changed)"
  for c in python3 node npm git docker doppler; do printf '%-8s %s\n' "$c" "$(command -v "$c" || echo missing)"; done
  [ -x "$HOME/.npm-global/bin/claude" ] && echo "claude   $("$HOME/.npm-global/bin/claude" --version)" || echo "claude   missing (scripts/dev/install-claude-code.sh)"
  [ -x "$VENV/bin/python" ] && echo "venv     present ($VENV)" || echo "venv     missing"
  if py_probe; then echo "services reachable: postgres $POSTGRES_HOST:$POSTGRES_PORT, redis $REDIS_HOST:$REDIS_PORT"; else echo "services NOT reachable"; fi
  echo "doppler token: $([ -n "${DOPPLER_TOKEN:-}" ] && echo set || echo not set)"
  exit 0
fi

command -v python3 >/dev/null || { echo "python3 is required (3.11)." >&2; exit 1; }

# --- 1. Postgres + Redis ----------------------------------------------------------------------------------------
log "Postgres + Redis"
if py_probe; then
  echo "already reachable (postgres $POSTGRES_HOST:$POSTGRES_PORT, redis $REDIS_HOST:$REDIS_PORT)"
elif [ "$COMPOSE" = 1 ] && command -v docker >/dev/null 2>&1; then
  retry docker compose -f "$COMPOSE_FILE" up -d db redis
  for _ in $(seq 1 60); do py_probe && break; sleep 2; done
  py_probe || { echo "Postgres/Redis did not become reachable. Check: docker compose -f .devcontainer/docker-compose.yml logs" >&2; exit 1; }
else
  echo "Postgres/Redis not reachable and Docker is not available. Inside the dev container they start automatically;" >&2
  echo "otherwise point POSTGRES_*/REDIS_* at running instances (docs/CLOUD_DEV.md)." >&2; exit 1
fi

# --- 2. Python environment --------------------------------------------------------------------------------------
log "Python environment ($VENV)"
[ -x "$VENV/bin/python" ] || python3 -m venv "$VENV"
REQ="$BACKEND/requirements.txt"
LIGHT="$VENV/requirements.light.txt"
if [ "$FULL" = 1 ]; then cp "$REQ" "$LIGHT"; else
  # Heavy, lazily-imported AI/ML packages are skipped; memory embeddings, voice and browser tools degrade gracefully (see docs/CLOUD_DEV.md).
  grep -v -i -E '^(sentence-transformers|faster-whisper|playwright)\b' "$REQ" > "$LIGHT"
fi
printf 'pytest\npytest-asyncio\nhttpx\nrespx\nruff\n' >> "$LIGHT"
want="$(sha256sum "$LIGHT" | cut -d' ' -f1)"
if [ -f "$VENV/.deps.sha" ] && [ "$(cat "$VENV/.deps.sha")" = "$want" ]; then
  echo "dependencies unchanged; skipping pip"
else
  retry "$VENV/bin/python" -m pip install --prefer-binary --retries 5 --timeout 30 -r "$LIGHT"
  echo "$want" > "$VENV/.deps.sha"
fi

# --- 3. Migrations ----------------------------------------------------------------------------------------------
log "Database migrations"
( cd "$BACKEND" && "$VENV/bin/python" -m alembic upgrade head )

# --- 4. Optional frontend ---------------------------------------------------------------------------------------
if [ "$FRONTEND" = 1 ]; then
  log "Frontend dependencies (app/)"
  ( cd "$ROOT/app" && retry npm ci --no-audit --no-fund )
fi

# --- 5. Claude Code + Doppler status ----------------------------------------------------------------------------
log "Tools"
[ -x "$HOME/.npm-global/bin/claude" ] || bash "$ROOT/scripts/dev/install-claude-code.sh" || echo "WARN: Claude Code install failed (non-fatal)" >&2
command -v doppler >/dev/null 2>&1 && echo "doppler $(doppler --version)" || echo "doppler not installed (optional): bash .devcontainer/install-doppler.sh"
echo "doppler token: $([ -n "${DOPPLER_TOKEN:-}" ] && echo 'set (value not shown)' || echo 'not set -> using dev defaults')"

log "Ready in $(( $(date +%s) - t0 ))s. Activate: source backend/.venv-linux/bin/activate"
echo "Run the API:   ./scripts/dev/bootstrap.sh --start      Tests: source scripts/dev/env.sh && cd backend/python && ../.venv-linux/bin/python -m pytest -m 'not integration'"

# --- 6. Optionally start the API --------------------------------------------------------------------------------
if [ "$START" = 1 ]; then
  log "Starting API on :8000"
  cd "$BACKEND"
  if [ -n "${DOPPLER_TOKEN:-}" ] && command -v doppler >/dev/null 2>&1; then
    exec "$VENV/bin/python" "$ROOT/scripts/secrets/run.py" --service backend --env "$JAZPER_ENV" -- "$VENV/bin/python" run_server.py --port 8000
  fi
  exec "$VENV/bin/python" run_server.py --port 8000
fi
