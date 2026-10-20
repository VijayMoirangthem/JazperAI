# Timeout

A model, connector or sandbox run took too long.

## Steps
1. Check whether the machine is busy (many Docker/Chrome processes).
2. Retry once. If a connector: restart it from Connections (Disconnect, Connect).
3. If it repeats, lower `max_tokens` for the bot or choose a faster model.

## Escalate
If this does not fix it, ask Jasper (it can read `alerts`) or Incident Response; record the cause in `docs/ops/` when it was not obvious.
