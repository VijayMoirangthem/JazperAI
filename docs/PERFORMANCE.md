# Performance Settings and resource-aware agents

Jazper runs entirely on your own PC. This feature lets the hierarchical multi-agent system adapt to the hardware it is on:
switch individual agents on or off, cap concurrency, slow background activity down, and see what Jazper really uses. The agent
hierarchy and every agent's data are unchanged; nothing is deleted when an agent is deactivated.

Open it in the app: **Performance** (Agent OS group). API: `/api/performance/*`.

## Presets

| | Eco | Balanced | Performance | First run (nothing saved) |
|---|---|---|---|---|
| Max active agents (non-critical) | 8 | max(16, 2×cores) | unlimited | unlimited |
| Concurrent agent tasks | 1 | 3 | cores/2 (2–12) | cores/2 (2–12) |
| Concurrent background jobs | 1 | 2 | cores/3 (2–8) | cores/3 (2–8) |
| Polling slow-down | ×3 | ×1.5 | ×1 | ×1 |
| Realtime UI update gap | 1000 ms | 400 ms | 100 ms | 100 ms |
| Animations / max FPS | off / 20 | reduced / 30 | full / 60 | full / 60 |
| Log level / live-log entries | WARNING / 200 | INFO / 500 | INFO / 2000 | INFO / 2000 |
| MCP auto-connect, file watcher, auto-repair loop | off | on | on | on |
| PII engine | regex | presidio | presidio | presidio |
| Memory budget (warning) | 10% of RAM (≥512 MB) | 20% (≥1 GB) | 50% (≥2 GB) | 50% (≥2 GB) |

* A fresh install keeps today's behaviour (no agent cap, no throttling). Presets are explicit choices.
* Applying a preset first shows which agents would be deactivated (the least-used non-critical ones); you confirm.
* Every value can be edited individually afterwards (the preset then shows as `custom`). Settings are stored in Postgres
  (`shared.perf_settings`) and cached in the browser, so they survive restarts.

## Agent activation

* Any agent, built-in persona or DB-defined, can be activated/deactivated individually, in bulk, or per crew
  (`PUT /api/performance/agents/{slug}`, `POST /api/performance/agents/bulk`).
* No row means active, so nothing changes until you switch something off. Deactivating **keeps** the agent's definition,
  settings, memory and history (`shared.agent_activation` is only an overlay).
* A deactivated agent:
  * is not routed work (orchestrator, `registry.message`), and built-in persona agents are not even instantiated;
  * has its scheduled jobs paused (and DB cron jobs skip while it is off);
  * is hidden from the org tree and rosters used by Office, Chat and Mind Map, unless *show inactive agents* is on.
* **Critical agents** (`jasper`, `commander`, `shield`) cannot be deactivated by bulk actions or presets and do not count against
  the limit; a single deliberate deactivation needs `force=true`. The Sentry error-watcher job is always on.
* The active-agent limit blocks activating more agents than allowed; critical agents are exempt.

## What each setting really does

| Setting | Enforced by | Notes |
|---|---|---|
| Max active agents | backend | blocks activation beyond the limit; presets deactivate the least-used agents to fit |
| Max concurrent agent tasks | backend limiter | wraps orchestrated persona runs and DB-bot messages; re-entrant, so an agent calling another agent never deadlocks |
| Max concurrent background jobs / enable | backend limiter + scheduler | every async scheduled job runs through the limiter; "off" pauses all jobs except essential ones |
| Polling slow-down | frontend | scales the default `useApi` polling and 22 timers; applied when a view (re)mounts; polling also pauses while the window is hidden. The server's alert-check interval (2 min) and repair-loop poll scale too |
| Realtime UI update gap | frontend | agent status/action/message/activity WebSocket events are applied in one batch per gap |
| Animations / max FPS | frontend | CSS switch (loading spinners always stay); FPS cap in the Office 3D loop and the Office 2D (Phaser) game |
| Log verbosity | backend | changes the log level immediately |
| Live-log retention | backend | size of the in-memory live-log buffer (the Logs view) |
| MCP auto-connect | backend | connectors (e.g. the GitHub MCP server, a separate Node process) are not started at boot; connect from the hub when needed |
| File watcher | backend | start/stop immediately (stop used to be a no-op) |
| Auto-repair loop | backend | when off the log watcher idles and nothing triggers the IT repair chain |
| PII engine | backend | `regex` skips the spaCy/Presidio second opinion. The regex rules always run first and cover email, phone, IP and IBAN as well as Aadhaar/PAN/card/token patterns |
| Memory budget | monitor | shows a warning when the app's total RAM exceeds it |

Not covered (yet): the Office 3D scene has its own *quality* setting and is only FPS-capped here; the legacy `/api/agents/live`
department view is a separate older model and is not filtered.

## Monitoring (real measurements)

`GET /api/performance/status` and the Overview tab report, from the live process tree (via `psutil`, no simulation):
CPU (% of one core, from CPU-time deltas), total RAM and threads, every child process (MCP servers etc.) with its RAM,
active/inactive/critical agent counts, running and queued agent tasks, background-job and scheduler counts, host RAM/CPU, and
warnings (over memory budget, high CPU, queued tasks, over the agent limit, low system memory).

To measure the backend yourself (use a throwaway database):

```bash
python scripts/perf/measure_backend.py --label mine --warmup 100 --duration 60 --out mine.json
```

## Tests

`backend/python/tests/test_perf_core.py`, `test_perf_db.py`, `test_perf_enforcement.py` (presets, validation, limiter incl. nested
calls and cancellation, monitor, activation, critical protection, cap, persistence, scheduler gating, file watcher, PII path,
HTTP API, cache busting) and `app/tests/perfRuntime.test.mjs` (poll scaling, coalescing, FPS cap).

## Measured results (this PC, backend only)

Method: `scripts/perf/measure_backend.py`, real backend process tree, throwaway Postgres/Redis, idle (no UI, no LLM calls),
100 s warm-up then a 60 s window, one run per row. "Before" is the unmodified `main` in the real repo folder. 12 logical cores.

| Scenario | Startup | RAM (avg) | CPU (% of one core) | Threads | Processes |
|---|---|---|---|---|---|
| Before (`main`) | 25.8 s | 594 MB | 11.5% | 54 | 7 |
| After, first-run defaults | 18.4 s | 590 MB | 3.1% | 54 | 7 |
| After, Balanced (24 of 56 non-critical agents active) | 21.5 s | 587 MB | 2.3% | 54 | 7 |
| After, **Eco** (8 of 56 non-critical agents active) | 18.4 s | **182 MB** | **0.28%** | **3.5** | **2** |

What produced the changes, from the stack/process evidence gathered while measuring:

* **Idle CPU (−73% on defaults):** the project file watcher recursed the whole repo and received about 70 filesystem events per
  second while idle, almost all from `data/minio` and `Project_References/mem0`, each costing a path resolve. Those top-level
  folders are now ignored. (Eco also turns the watcher off.) This is a fix independent of the presets.
* **RAM (−69% in Eco):** the GitHub MCP connector auto-started through `npx` (about 190 MB across Node processes) and the
  Presidio/spaCy PII engine loaded on the first audit write (backend process 401 MB with it, 178 MB without: about 220 MB). Eco starts
  neither (PII falls back to the regex rules).
  Balanced and the defaults keep both, so their RAM is unchanged within noise (about 1% lower).
* **Not a measured gain:** the frontend. Polling scaling, event coalescing, FPS caps and animation switches are unit-tested,
  type-checked and built, but I did not measure browser CPU/network, so no figure is claimed.

Caveats: single runs on one machine; the file-event rate varies with what else is touching the repo (an earlier pair of runs showed
25–32% CPU with the same code before the watcher fix), so CPU differences of a few percent are within noise. An early A/B against
`main` run from a scratch folder was invalid (the watcher root follows the code location) and is not used.

Remaining bottlenecks: the ~180 MB backend-process floor (imported libraries) and the ~220 MB the PII/NLP stack adds when it loads;
the MCP server processes when connected (about 195 MB for the GitHub connector); startup of about 18–25 s; and the 3D office render cost, which is only FPS-capped.

## Chat speed (measured 2026-11-13, phone path `/remote/v1/chat/stream`, warm backend, 16 GB PC under memory pressure)

| Message | Before | After | What changed |
|---|---|---|---|
| "hi jasper" | 6.3 s | 0.7-1.2 s | memory lookup no longer waited on |
| "Mera system ka status batao" | 6.3 s | 0.2-0.3 s | deterministic answer, skips memory |
| "what time is it" | 6.0 s | 1.0-2.6 s | memory skipped when it cannot help; model time varies |
| "Kunal ka aaj ka email dikhao" | 10.3 s | 2.3-2.8 s | skips memory; Gmail warmed at start (first one after a restart was 15 s) |

**Cause:** every message waited up to 4 s for memory recall. The memory model (BAAI/bge-m3, ~2 GB) is unloaded when idle and takes ~25 s to
load cold, so the wait almost always ran to its limit and recall returned nothing anyway.

**Now:** recall is skipped for deterministic answers (status, email, Drive) and bare greetings; it is skipped (and the model warms in the
background) when the model is not loaded or the PC has under 2.5 GB free RAM; when it is loaded the wait is capped at 0.8 s and the
memory layers are searched in parallel. Gmail is warmed 8 s after start. Regression tests: `tests/test_chat_speed.py`.

**Floor:** the model itself answers in about 0.5 s (Groq, gpt-oss-20b), so a plain reply cannot be faster than ~0.5-1 s with a hosted model.
Replies that use tools take two model calls. Faster than that needs a smaller/local model for chit-chat or prefetching; not done.

**Tip (Windows):** use `127.0.0.1`, not `localhost`, for local clients: `localhost` adds 0.2-2 s per new connection here (IPv6 fallback).
