# Cloud development environment (Codespaces / dev container)

Goal: open the repo in a Codespace, run **one command**, and have Postgres (pgvector), Redis, the Python backend, Doppler and
Claude Code ready, without manual setup and without the crashes of the earlier image-only container.

## What you get

| Piece | How |
|---|---|
| Dev container | `mcr.microsoft.com/devcontainers/python:1-3.11-bookworm` (Debian 12, supported) + Node 22 feature. Defined in `.devcontainer/docker-compose.yml`. |
| Postgres 16 + pgvector | compose service `db` (same image as `infra/docker-compose.yml`), reachable from the workspace as `db:5432`, from the host as `127.0.0.1:5433`. |
| Redis 7 | compose service `redis` (password-protected), `redis:6379` / `127.0.0.1:6379`. |
| Python env | `backend/.venv-linux` (git-ignored; separate from the Windows `backend/.venv`). |
| Claude Code | installed to a user-owned prefix `~/.npm-global` (no sudo), version pinned in `scripts/dev/install-claude-code.sh`. |
| Doppler CLI | existing pinned, signature-verified installer `.devcontainer/install-doppler.sh`. |
| Resource caps | db 1 GB, redis 256 MB, workspace 4 GB; `hostRequirements` asks for 2 cores / 4 GB / 32 GB. |

Everything above is **development only**. Credentials in the compose file are throwaway defaults for containers that are not
exposed beyond `127.0.0.1`; override with `POSTGRES_PASSWORD` / `REDIS_PASSWORD` (Doppler or Codespaces secrets). Nothing here
deploys or configures production, and your existing Windows workflow (`infra/docker-compose.yml`, `scripts/dev.ps1`) is unchanged.

## Start

1. Create the Codespace (or *Dev Containers: Reopen in Container*). `postCreateCommand` only installs Doppler and Claude Code
   and **never fails the build** (a flaky network cannot trap you in recovery mode).
2. In the terminal:
   ```bash
   ./scripts/dev/bootstrap.sh            # services + venv (light deps) + migrations + checks
   ./scripts/dev/bootstrap.sh --start    # same, then run the API on :8000
   ```
   Options: `--full` (heavy ML deps), `--frontend` (`npm ci` in `app/`), `--check` (report only), `--no-compose`.
3. Tests: `source scripts/dev/env.sh && cd backend/python && ../.venv-linux/bin/python -m pytest -q -m "not integration"` (`env.sh` exports the dev connection settings; the dev container already has them).
4. Claude Code: `claude` (log in once; open a new terminal if `claude` is not on PATH yet, or run `export PATH=$HOME/.npm-global/bin:$PATH`).

## Light vs full dependencies

`--full` installs everything in `backend/python/requirements.txt`. The default **skips** `sentence-transformers` (pulls torch),
`faster-whisper` and `playwright`. They are imported lazily, so the API and almost all tests run without them:

| Skipped | Effect without it |
|---|---|
| sentence-transformers | memory embeddings return `None` (embedder tests skip; memory search degrades) |
| faster-whisper | voice transcription endpoints unavailable |
| playwright | browser/Voyager/LinkedIn tools unavailable |

`requirements.txt` itself is unchanged, so production builds are unaffected.

## Doppler

If `DOPPLER_TOKEN` is set (Codespaces user secret), `--start` runs the API through `scripts/secrets/run.py`, which injects
secrets from the vault and fails closed if required ones are missing. Without a token the dev defaults are used. The token is
never printed. Authentication itself is a founder step: create the project/config and a read-only service token in the Doppler UI
(see `docs/SECRETS_ARCHITECTURE.md`), then add it as a Codespaces secret named `DOPPLER_TOKEN`.

## Stop, rebuild, reset

| Task | Command |
|---|---|
| Stop the stack | close the Codespace (it stops the compose services) or `docker compose -f .devcontainer/docker-compose.yml stop db redis` |
| Restart services | `./scripts/dev/bootstrap.sh` (idempotent) |
| Rebuild container | Command palette: *Codespaces: Rebuild Container* (the repo, venv and database volume are kept) |
| Full clean rebuild | *Codespaces: Full Rebuild Container*, then `docker volume rm jazper-dev_pgdata` to wipe the dev database |
| Recreate venv | `rm -rf backend/.venv-linux && ./scripts/dev/bootstrap.sh` |

## Troubleshooting

* **Recovery mode / "unable to find user vscode"**: `devcontainer.json` must not set `remoteUser` to a user the image lacks. This
  config uses the image default. The Alpine shell you may have seen is the Codespaces *recovery container*, not this image.
* **`bootstrap.sh` says Postgres/Redis unreachable**: inside the dev container run `docker compose` is not available; services come
  from the compose stack, so rebuild the container. Outside it, install Docker or pass `--no-compose` with `POSTGRES_*`/`REDIS_*`.
* **`claude: command not found`**: `bash scripts/dev/install-claude-code.sh`, then `export PATH=$HOME/.npm-global/bin:$PATH`.
* **pip/npm network failures**: steps retry 3x; just re-run `bootstrap.sh`, it resumes (pip is skipped when dependencies are unchanged).
* **Slow or frozen Codespace**: use `--check` to see what is running; avoid `--full` and `--frontend` unless needed; use at least a
  2-core/8 GB machine type for `--full`. The Windows-only `node_modules` and `.venv` folders are not shared into the container.
* **Tests that need Docker** (`-m integration`, the sandbox) are not runnable inside the dev container (no nested Docker); CI runs them.

## Validation

`.github/workflows/devenv-validate.yml` runs on every change to this environment: JSON/compose/shell checks (incl. shellcheck), a
cold and a warm `bootstrap.sh` against real Postgres+Redis containers, a Claude Code install check, and representative database tests.
A real *Rebuild Container* inside GitHub Codespaces can only be done by you in the browser; it is not covered by CI.
