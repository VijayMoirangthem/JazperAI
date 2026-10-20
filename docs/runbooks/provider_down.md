# Provider down (all providers failed / connection error)

Every model in the tier chain failed.

## Steps
1. Open the Model catalogue and press Test on each provider; read the status chip (works / needs credit / blocked / bad key).
2. If the network is down, nothing to fix locally; retry later.
3. If one provider has a bad key: AI Providers > edit key. If out of credit: top up, then Test.
4. The circuit breaker reopens after 30 s; no restart is needed.

## Escalate
If this does not fix it, ask Jasper (it can read `alerts`) or Incident Response; record the cause in `docs/ops/` when it was not obvious.
