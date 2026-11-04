# Jazper AI - Central Secrets Management

Status: **proposal, implemented in code; vault account not yet created.** Nothing here has been deployed, no paid service is enabled, no credential has been rotated.

## 1. Goals and non-goals

- Enter or change each secret in **one** place (the vault UI). Runtimes and CI receive only what they need, as environment variables injected at process start.
- No plaintext credentials in Git, Google Drive, logs, frontend bundles or generated artifacts.
- A vault does **not** remove one-time provider setup. Each runtime still needs one bootstrap credential (section 7).
- Non-goal: replacing the local OS-keystore vault (`backend/python/core/vault.py`), which stores per-user app credentials on the founder's PC. That is a different layer and stays.

## 2. Threat model

| Threat | Mitigation |
|---|---|
| Secret committed to Git | `.gitignore` blocks `.env*`; `scripts/secrets/check_repo.py` fails CI on tracked env files or values in templates; gitleaks scans full history on every PR; existing pre-commit gitleaks hook |
| Secret in frontend bundle | Manifest classifies every variable; only `public` kind may use `NEXT_PUBLIC_`/`VITE_`; `secrets_guard.public_leaks` and `check_repo.py` reject secret names under those prefixes |
| Secret in logs | Guard errors print variable **names** only; gitleaks runs with `--redact`; vendor CLIs inject via process env, not files |
| Leaked CI/host token | One token per service+environment, read-only, scoped to one vault config; rotation in section 8 |
| Prod secrets reachable from dev | Separate vault environments and separate tokens; mock mode is refused outside `dev`; prod tokens never go to Codespaces or developer laptops |
| Vault outage | Fail closed for required secrets (section 11); running processes keep their already-injected env |
| Compromised vendor | Accepted risk of any SaaS vault; mitigated by least-privilege tokens, rotation, and a documented exit to self-hosted Infisical (MIT) |
| Stolen laptop | Developer sessions are per-person and revocable; OS disk encryption (BitLocker) recommended; no secrets on disk |

## 3. Vendor selection (verified 2026-11-03 from public pricing pages)

| | Doppler Developer (free) | Infisical Cloud Free |
|---|---|---|
| Users | 3 (pricing card) - the comparison table says 25; unreconciled, **verify at signup** | 5 *identities total, humans + machines* |
| Machine credentials | 50 service tokens | counted inside the 5 identities |
| Projects / environments | 10 / 4 | unlimited / 3 |
| Audit log retention | 3 days | not on free tier |
| Secret versioning / rollback | not stated on page | **not available** on free |
| Native syncs | config syncs capped at 5 (feature page lists integrations) | 10 syncs |
| Self-host exit | no | yes, MIT core |

**Selection: Doppler (Developer, free) as primary.** Rationale: least-privilege needs one token per service x environment (roughly 8-10 tokens: GitHub Actions, Codespaces, Render x2, Vercel x2, local), which Infisical's 5-identity cap would not allow without paying; Doppler also keeps 4 environments (dev, staging, prod + spare). **Fallback: Infisical** (the launcher already supports `--vendor infisical`) if Doppler terms change or self-hosting becomes attractive.

Verify before relying on it: both pages are marketing pages and can change; re-check limits at signup. This repo's code does not depend on either vendor - it reads environment variables.

### Free-tier limitations to accept
Three-day audit retention (export logs if you need longer), no guaranteed SLA, user cap, no SSO/SCIM. If any limit blocks you, **stop and ask the founder**: upgrading is a recurring cost and needs explicit approval.

## 4. Environments

| Env | Vault config | Who/what reads it | Mock allowed |
|---|---|---|---|
| local/dev | `dev` | founder laptop, Codespaces, CI tests | yes (`--mock`, fixtures only) |
| staging | `stg` | Render/Vercel staging services | **no** |
| prod | `prd` | Render/Vercel prod services only | **no** |

Doppler requires one config name per environment; the manifest's `dev|staging|prod` maps to them. CI uses fake credentials, never vault secrets, for tests.

## 5. Access matrix (who holds what)

| Principal | dev | staging | prod | Credential |
|---|---|---|---|---|
| Founder (human) | rw | rw | rw | vendor login + 2FA |
| Developer (future) | rw | r | none | per-person login, revocable |
| Local backend | r | - | - | `doppler login` session |
| Codespaces | r | - | - | `DOPPLER_TOKEN` (dev config) as a Codespaces user/repo secret |
| GitHub Actions tests | none | none | none | fake env only |
| GitHub Actions deploy (future) | - | r | r (approval-gated environment) | `DOPPLER_TOKEN_*` as GitHub Environment secrets |
| Render service | - | r | r | `DOPPLER_TOKEN` env var per service (one token each) |
| Vercel project | - | r | r | `DOPPLER_TOKEN` or Doppler->Vercel sync (verify first) |
| Supabase | - | - | - | see section 9 |

Variable-level scoping: `config/secrets.manifest.json` lists which service needs which name. In the vault, create **one vault config per service+env** (for example `backend_prd`, `app_prd`) containing only the manifest names for that service, so a token cannot read other services' secrets.

## 6. How secrets reach processes

```
vault (UI, founder-entered) --service token/session--> `doppler run` --env vars--> scripts/secrets/run.py check --> your command
```

- `scripts/secrets/run.py` wraps the vendor CLI, validates the injected env against the manifest (`backend/python/core/secrets_guard.py`), then execs the real command. Nothing is written to disk.
- Required-in-prod names are in the manifest (`required_in`). Missing or empty means exit code 3 and a names-only message.
- Frontend builds take only `public` variables; the Vite `app/` and Next `frontend/` templates contain nothing else.

### Local onboarding

```powershell
# one-time (founder signs in in the browser; no secret is typed into a terminal history)
winget install Doppler.doppler        # or: scoop install doppler
doppler login
doppler setup --project jazper --config dev
# every day
python scripts/secrets/run.py --service backend --env dev -- backend\.venv\Scripts\python backend\python\run_server.py
```

No vault access yet? Use the non-sensitive fixtures (dev only):

```powershell
python scripts/secrets/run.py --service backend --mock -- backend\.venv\Scripts\python -m pytest backend\python\tests -q
```

The existing `backend/python/.env` still works for local runs (Settings reads it), and stays git-ignored. Migrate off it once the vault is populated and delete the file.

## 7. Bootstrap credentials (unavoidable)

A runtime cannot fetch secrets without an identity. Per runtime, exactly one credential is provisioned by the founder in that platform's own settings, never in Git:

| Runtime | Bootstrap credential | Where it is stored |
|---|---|---|
| Developer laptop | interactive `doppler login` | OS keychain managed by the CLI |
| Codespaces | `DOPPLER_TOKEN` (dev, read-only) | GitHub -> Settings -> Codespaces -> Secrets |
| GitHub Actions (deploy) | `DOPPLER_TOKEN` per environment | GitHub Environments secrets |
| Render | `DOPPLER_TOKEN` | Render service environment |
| Vercel | `DOPPLER_TOKEN` or synced vars | Vercel project environment |

Everything else (Groq, Anthropic, Google, database passwords...) lives only in the vault.

## 8. Rotation, onboarding, offboarding, recovery, audit

- **Rotate a provider secret**: create the new key at the provider, update it in the vault (one place), restart services (Render/Vercel redeploy; local re-run), revoke the old key.
- **Rotate a service token**: create new token for that vault config, replace it in the platform setting, redeploy, revoke the old token.
- **Onboard**: invite to the vendor workspace with `dev` access only; they run the local onboarding commands. No secrets are ever sent in chat, PRs or email.
- **Offboard**: remove from the vendor workspace, revoke any service tokens they created, rotate every secret they could read (at least all `dev` config secrets), review GitHub collaborators.
- **Recovery**: keep an offline export of the vault (vendor's encrypted export or `doppler secrets download` into an encrypted container, e.g. a password manager attachment) in a place that is not Google Drive plaintext. If the vendor account is lost, secrets must be re-issued from the providers; the manifest lists every name to re-create.
- **Audit**: use the vendor activity log (3 days on free Doppler); GitHub audit for token secrets; re-run the gitleaks scan monthly.

### If a leak is confirmed
1. Treat the value as burned; rotate at the provider first, then in the vault. 2. Revoke old key. 3. Check provider usage logs. 4. Remove from Git history only after rotation (`git filter-repo`, coordinated force-push is a founder decision). 5. Record the incident (names, dates, no values) in `docs/`.

**History check performed (2026-11-03):** `gitleaks v8.30.0` over all 123 commits reachable locally with redaction: *no leaks found*. A targeted `git log -G` for common key patterns (Groq, Anthropic, OpenAI, GitHub, AWS, Google, private keys) found 0 commits. Only `*.env.example` files were ever tracked. Limitation: this does not cover remote branches not fetched, Google Drive copies, or the local-only (git-ignored) `.env` files, which hold real values on the founder's PC - **consider those values exposed to anything that has read your disk or Drive sync, and rotate them when migrating to the vault.**

## 9. Platform integration (verified vs. unverified)

| Platform | Mechanism | Native pull? | Status |
|---|---|---|---|
| GitHub Actions | `doppler run` after installing CLI with `DOPPLER_TOKEN` env from GitHub Environment secret | CLI-based, not native | Example below; **not yet run** (no vault) |
| Codespaces | `DOPPLER_TOKEN` Codespaces secret, then the same run command | no | Example below; unverified |
| Render | Set `DOPPLER_TOKEN`; start command `doppler run -- python scripts/secrets/run.py ...` needs the CLI in the build image (install in build command) | no native; vendor offers a Render sync (**unverified, limited on free**) | Token + start command is the safe path |
| Vercel | Vendor integration syncs vars into Vercel project env, or fetch at build with the CLI | sync available per vendor docs (**unverified**; counts against the 5-sync cap) | Only `public` values may reach the browser build |
| Supabase | Supabase project keys and DB passwords are created in Supabase's dashboard and **copied** into the vault. Edge Functions secrets are set via `supabase secrets set` (a sync step) | no | The anon key is public; `service_role` is server-only and must live only in `backend_*` configs |
| Baeit / Boardmint (future) | New vault project each, same manifest pattern and same token-per-service rule | n/a | Copy `config/secrets.manifest.json` and the guard |

Never claim any row works until the founder has created the vault and the example has been run.

### GitHub Actions example (deploy-style, not enabled)
```yaml
jobs:
  smoke:
    environment: staging
    steps:
      - uses: actions/checkout@v4
      - run: curl -Ls https://cli.doppler.com/install.sh | sh   # pin a version/checksum before use
      - run: python scripts/secrets/run.py --service backend --env staging --check-only
        env: { DOPPLER_TOKEN: "${{ secrets.DOPPLER_TOKEN }}" }
```

### Codespaces / Render start commands
```bash
# Codespaces terminal
python scripts/secrets/run.py --service backend --env dev -- python backend/python/run_server.py
# Render start command (after installing the doppler CLI in the build step)
python scripts/secrets/run.py --service backend --env prod -- uvicorn main:app --host 0.0.0.0 --port $PORT
```

## 10. Repository state notes

- `app/` (Vite) was found to reference `../frontend/src`, which does **not** exist in the pushed tree (`frontend/` contains only `.env.example` and `next-env.d.ts`). This work did not create or modify any frontend source. The `app/.env.example` and `frontend/.env.example` are public-only templates.
- Existing CI repairs live on `chore/cloud-ci-repair-20261103` and are untouched. The new workflow `secrets-guard.yml` is separate.
- `backend/infra/.env.example` previously held `changeme` passwords; they are now empty so no value (even a placeholder) is tracked.

## 11. Failure behaviour

| Condition | Behaviour |
|---|---|
| Vault CLI missing | launcher exits 2 with install hint; `--mock` for dev |
| Vault unreachable / bad token | vendor CLI exits non-zero; command does not run |
| Required secret empty (staging/prod) | exit 3, names listed, command does not run |
| `--mock` outside dev | exit 3 refused |
| Optional secret missing | feature using it stays disabled; no startup failure |
| Runtime vault outage after start | process keeps its already-injected env; restarts fail closed |

Note: the launcher enforces the checks. Starting `uvicorn` directly bypasses them (Settings still requires `POSTGRES_PASSWORD`/`REDIS_PASSWORD`). Production start commands must go through the launcher.

## 12. Cost

$0 recurring on the free tiers above. Triggers needing founder approval: more than the free user cap, longer audit retention, SSO, or any hosted sync beyond the cap. Self-hosting Infisical would add hosting + maintenance cost and is **not** recommended now.

## 13. Migration checklist

1. [ ] Inventory: review `config/secrets.manifest.json` (names only) - correct anything missing.
2. [ ] Founder creates the Doppler workspace (2FA on) and project `jazper` with configs `dev`, `stg`, `prd`.
3. [ ] Founder enters secrets **in the vendor UI** (never in chat, PRs or this repo). Rotate any value that lived in Drive/plain `.env`.
4. [ ] Create per-service configs and read-only service tokens; store each in its platform's secret store.
5. [ ] Test dev: `doppler setup`, run the launcher, run backend tests.
6. [ ] Test staging with a staging token on a staging service.
7. [ ] Founder approves prod; create prod tokens; deploy; verify; delete local `.env` files.
8. [ ] Revoke old keys; record the date.
