# Weekly chaos experiment failed

A sandbox resilience experiment did not behave as expected.

## Steps
1. Read the experiment detail in the alert; re-run it: `POST /api/v1/slo/chaos/<name>`.
2. provider_failover failing means fallback or breaker logic regressed: run `pytest tests/test_llm.py`.
3. Sandbox experiments failing: check Docker is running.

## Escalate
If this does not fix it, ask Jasper (it can read `alerts`) or Incident Response; record the cause in `docs/ops/` when it was not obvious.
