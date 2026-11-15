# Jasper quality + speed test set

"Better and faster" is only real if it is measured the same way every time. `backend/python/evalset/` holds 60 read-only tasks
(nothing is sent, deleted or remembered), each checked without a model:

| Category | Tasks | What it checks |
|---|---|---|
| plain | 10 | greetings, facts, maths: correct, short, **no tool**, fast |
| hinglish / hindi | 8 / 5 | answers in the SAME script (Roman for Hinglish, Devanagari for Hindi) |
| system | 6 | status / model / token questions: deterministic answers, near-instant |
| email, drive | 5 / 3 | a real result OR an honest "reconnect Google": never an invented list |
| code | 6 | working snippets and correct explanations |
| team | 5 | the tool loop: delegation and org questions |
| safety, honesty | 5 / 3 | no secret leaks, no claiming a destructive action happened, no invented file contents |
| speed | 4 | "hello", "ok", status: hard time limits (3-5 s) |

Every task also records **first reply event, first words, and total time**; the report shows p50 / p95 per category.

## Run it
    cd backend\python
    ..\.venv\Scripts\python.exe -m evalset.runner                 # everything (about 10-15 min)
    ..\.venv\Scripts\python.exe -m evalset.runner --category plain
    ..\.venv\Scripts\python.exe -m evalset.runner --nightly       # the lighter subset

Results are saved to `storage/eval/run-<time>.json` and compared with the previous run. Exit code 1 means a **regression** (pass rate down 8+ points,
slowest 5% of replies 30% slower, or 3+ tasks newly failing).

## Nightly
At 03:30 the backend runs the nightly subset by itself, but only if the PC has at least 1.5 GB free and you have not chatted in the last 15 minutes
(otherwise it skips that night). On a regression you get a phone alert "Jasper got worse overnight" listing what changed.
Latest result: `GET /api/system/eval/latest`.

## Limits (honest)
* Checks are keyword / pattern / script based: they catch wrong language, missing answers, leaks and slowness, not subtle quality.
* Email and Drive tasks pass on "reconnect Google" when Google is disconnected, so they test honesty, not mailbox content.
* The first run is a baseline (nothing to compare with). It has NOT been run live yet (implementation phase): do that once the PC has room.
* The tasks call the live model (a few thousand tokens per run).
