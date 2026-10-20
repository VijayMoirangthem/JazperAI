# Control matrix (Plan V2 G4)

Maps what exists in the system to common control themes (SOC 2 trust criteria / ISO 27001 Annex A style). This is an engineering inventory, not an audit
or certification. Status: **Implemented**, **Partial**, **Gap**. Evidence is a file or endpoint you can inspect.

| # | Control | Status | Evidence |
|---|---|---|---|
| 1 | Access control and least privilege (tenant isolation) | Implemented | Row-level security on tenant tables, `app_runtime` role, `FORCE ROW LEVEL SECURITY` (`infra/migrations/versions/0003_tenancy_rls.py`, `core/tenancy.py`, `tests/test_rls.py`) |
| 2 | Human approval for risky actions | Implemented | Tier 1/2/3 policy, default-deny for unknown actions, persisted requests (`core/hitl.py`, `/api/v1/hitl/*`); Tier 3 always needs a human |
| 3 | Per-agent autonomy levels | Implemented | Ask / auto-accept edits / approve-for-me / full (`shared.approval_levels`, Chat "Ask" menu) |
| 4 | Tamper-evident audit log | Implemented | DB-trigger hash chain, redaction before write (`core/audit.py`, `scripts/audit_verify.py`, `tests/test_audit.py`) |
| 5 | Secrets management | Implemented | OS credential store + Fernet blobs with key rotation (`core/vault.py`); secrets never in chat or logs |
| 6 | Encryption at rest for backups | Implemented | AES-256-GCM, scrypt key (`scripts/backup_crypt.py`). Passphrase custody is a **Gap** (not backed up separately) |
| 7 | Backup and restore | Partial | Drill passed 2026-10-20 (`docs/ops/dr.md`); backups are manual, no offsite copy |
| 8 | Business continuity objectives (RPO/RTO) | Partial | Targets and measured restore time in `docs/ops/dr.md`; RPO not automated |
| 9 | Availability monitoring and SLOs | Implemented | `core/metrics.py`, `/metrics`, `/api/v1/slo/`, `docs/ops/slo.md`; no alerting yet (**Gap**) |
| 10 | Resilience testing | Implemented | ChaosBot, sandbox-only (`agents/chaos.py`, `/api/v1/slo/chaos`) |
| 11 | Safe execution of untrusted or AI-generated code | Implemented | Docker sandbox: no network, memory/pids/cpu limits (`hub/sandbox.py`, `tests/test_sandbox.py`, chaos experiments) |
| 12 | Change management | Implemented | Dev loop on a branch with tests, Tier-3 approval to merge to main (`agents/devloop.py`, `core/gitops.py`) |
| 13 | Third-party tool governance | Implemented | MCP hub: schema validation, tiering, rate limits, audit (`hub/hub.py`) |
| 14 | Cost control | Implemented | Ledger, budgets, hard/soft caps (`core/finops.py`, FinOps panel); real model prices still to be entered |
| 15 | Software supply chain | Partial | SBOM and license scan (`docs/compliance/sbom.cdx.json`, `licenses.md`, `scripts/license_scan.ps1`); dependencies pinned; no automated vulnerability scan (**Gap**) |
| 16 | Data minimisation and PII handling | Partial | Sanitiser on audit and memory writes (`memory/sanitizer.py`); no data-subject workflow (single-user system) |
| 17 | Tenant offboarding / separation | Partial | Spin-off packager with restore verification (`scripts/tenant_spinoff.py`); tenant business tables are not yet migrated into tenant schemas, so packages carry bots and schema only |
| 18 | Agent performance oversight | Implemented | Per-bot score, thumbs, errors, latency (`agents/orgchart.py`, Bot Reviewer bot, bot ID card) |
| 19 | Authentication of users | Gap (accepted) | Single-user local app; API is bound to localhost with no login. Needed before any remote or multi-user use |
| 20 | Incident response | Partial | IT Department repair tickets and error store; no written runbook or paging |
