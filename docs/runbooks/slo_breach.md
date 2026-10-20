# SLO error budget low or spent

Availability or latency target missed over the window.

## Steps
1. Open `/api/v1/slo/` and `/metrics`; find the failing route (`jasper_http_requests_total{status="5xx"}`).
2. Fix the top failing route; pause feature work until the 24 h window recovers.
3. Check recent incidents for the same time.

## Escalate
If this does not fix it, ask Jasper (it can read `alerts`) or Incident Response; record the cause in `docs/ops/` when it was not obvious.
