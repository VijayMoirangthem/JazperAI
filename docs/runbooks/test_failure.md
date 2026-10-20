# Feature run tests failed

The dev and QA bots could not make the tests pass in 3 attempts; the branch was rolled back.

## Steps
1. Open the run (`GET /api/v1/features/runs/{id}`) and read the events and the last test output.
2. Rephrase the task smaller, name the files to touch, and start a new run.
3. Nothing was merged; delete the leftover branch with Discard.

## Escalate
If this does not fix it, ask Jasper (it can read `alerts`) or Incident Response; record the cause in `docs/ops/` when it was not obvious.
