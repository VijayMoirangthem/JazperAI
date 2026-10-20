# Performance (Plan V3 W1) — measured 2026-10-21

Measured on this PC with `node scripts/loadtest.mjs` (30 sequential calls per endpoint against `127.0.0.1:8000`, which is what the UI feels) and a 50-concurrent burst (capacity, not UX).

## What was wrong and what changed
| Problem | Cause | Fix | Result |
|---|---|---|---|
| Tabs reloaded on every click | only the visible panel was mounted | keep-alive for the 8 most recent panels; polling pauses when hidden (`useViewActive`) | return to a panel < 400 ms, no reload (Playwright) |
| Panel data refetched blocking | each mount ran its own fetches | `lib/swr.ts` stale-while-revalidate (memory + sessionStorage, de-duplication) | instant paint from cache |
| Background polls never showed on screen | `swr.ts` only re-rendered on window focus | per-URL subscribers notified on every cache write | fixed |
| Office scene rebuilt every 5 s | the roster poll returned a new object, which was an effect dependency | rebuild only when the content signature changes; render loop sleeps when hidden | canvas survives 13 s of polling (Playwright) |
| 1.59 MB gzip main bundle | 78 panels imported statically | `React.lazy` per panel + hover preload of code and first data | 290 KB gzip (−82%); Monaco (3.8 MB) loads only when opened |
| `localhost` calls cost ~210 ms | Windows tries IPv6 first | API base `127.0.0.1` | 7 ms vs 210 ms per new connection (curl) |
| `/api/v1/slo/` took 6.8 s | one Redis key per minute, SCANned on every read | one hash per day, 1–2 HGETALL | 31 ms |
| Burst of identical requests recomputed | no single-flight | `cache.cached` shares one computation | no stampede |
| Panel endpoints re-queried the DB | no cache | Redis read-through cache (`core/http_cache.py`), invalidated on writes | `x-cache: HIT` |

## Latency now (sequential, p50 / p95 ms)
Every endpoint behind the rail is 23–70 ms p50. p95 is under 100 ms except cache-refresh moments: `bots/tree` 225, `mcp-hub/tools` 216 (they recompute when the 5–10 s cache expires). `comms/recent` was 311 and now reads only the newest entries.
Under a 50-concurrent burst p50 is 60–400 ms because Python serves one event loop; the UI never does this.

## Deliberately not done
- **gzip/brotli:** traffic is on loopback, so it saves nothing locally, and compressing the NDJSON chat stream risks buffering tokens. Revisit for the remote gateway (W8), where it matters.
- **ETag/304:** same reason; add with the remote gateway.
- **Materialised views:** no query is slow enough to need them.
- **Chat transcript virtualisation:** the transcript already renders a sliding window (`useTranscriptViewport`).

## Re-measure
`node scripts/loadtest.mjs` (backend running). Add a regression threshold to CI when a CI exists.
