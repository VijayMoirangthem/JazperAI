# Rate limit (429, tokens per minute)

The free model tier allows a limited number of requests/tokens per minute. One question can fan out into 8-10 calls.

## Steps
1. Check AI Providers > Model catalogue for the failing model and its last test.
2. Failover is automatic: the second Groq key and the tier chain take over. If both are limited, wait 60 s.
3. Reduce load: pin the busiest bot to a different provider (bot settings > Model), or lower `daily_token_cap` for chatty bots.
4. Permanent fix: add credit or another provider (OpenCode Zen needs balance) and put it in the tier chain.

## Escalate
If this does not fix it, ask Jasper (it can read `alerts`) or Incident Response; record the cause in `docs/ops/` when it was not obvious.
