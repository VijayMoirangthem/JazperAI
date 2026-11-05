#!/usr/bin/env bash
# Source this to get the development connection settings in your shell:  source scripts/dev/env.sh
# Inside the dev container the compose file already sets these (db/redis hosts); outside it, the published localhost ports
# are used. Dev-only throwaway defaults; export POSTGRES_PASSWORD / REDIS_PASSWORD (Doppler or Codespaces secrets) to override.
if getent hosts db >/dev/null 2>&1 && [ -z "${POSTGRES_HOST:-}" ]; then
  export POSTGRES_HOST=db POSTGRES_PORT=5432 REDIS_HOST=redis REDIS_PORT=6379
fi
export POSTGRES_HOST="${POSTGRES_HOST:-127.0.0.1}" POSTGRES_PORT="${POSTGRES_PORT:-${DEV_PG_PORT:-5433}}"
export POSTGRES_USER="${POSTGRES_USER:-sirjazper}" POSTGRES_DB="${POSTGRES_DB:-coos}" POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-jazper-dev-only}"
export REDIS_HOST="${REDIS_HOST:-127.0.0.1}" REDIS_PORT="${REDIS_PORT:-${DEV_REDIS_PORT:-6379}}" REDIS_PASSWORD="${REDIS_PASSWORD:-jazper-dev-only}"
export JAZPER_ENV="${JAZPER_ENV:-dev}"
