# Auth / permission error (401, 403)

Bad key, revoked key, or a model that is not allowed for this key (for example OpenCode free models outside the OpenCode app).

## Steps
1. Press Test on the model; read the error text.
2. Free OpenCode models: use the OpenCode CLI provider (chat only) instead of the API.
3. Replace the key in AI Providers if it is wrong.

## Escalate
If this does not fix it, ask Jasper (it can read `alerts`) or Incident Response; record the cause in `docs/ops/` when it was not obvious.
