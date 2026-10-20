# Tool call invalid

The model sent a malformed tool call or unknown tool.

## Steps
1. The loop already asks the model to retry once; check the comms log for the call.
2. If one bot keeps failing, switch it to the standard or frontier tier (light models are weak at tool calls).
3. Check the bot's tool switches (Behaviour tab).

## Escalate
If this does not fix it, ask Jasper (it can read `alerts`) or Incident Response; record the cause in `docs/ops/` when it was not obvious.
