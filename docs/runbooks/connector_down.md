# Connector down

An MCP connector process is not running or is DEGRADED.

## Steps
1. Connections: press Test; if it fails press Disconnect then Connect.
2. Gmail: sign-in may have expired; use Sign in with Google in the card.
3. Check docker/npx availability for npx-based connectors.
4. It also reconnects automatically at backend start.

## Escalate
If this does not fix it, ask Jasper (it can read `alerts`) or Incident Response; record the cause in `docs/ops/` when it was not obvious.
