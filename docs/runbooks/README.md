# Runbooks

One file per failure kind (see `core/alerts.py` KINDS). An alert or incident names its runbook. Tier 1 steps are safe to run without asking; Tier 2/3 steps need approval.

## Steps
- `rate_limit`, `provider_down`, `insufficient_funds`, `auth`, `timeout`, `context_overflow`: model provider problems
- `tool_schema`, `connector_down`: tools and connectors
- `test_failure`: feature flow and dev loop
- `slo_breach`, `backup_stale`, `minio_down`, `disk_low`, `approval_stuck`, `chaos_failed`: platform health
