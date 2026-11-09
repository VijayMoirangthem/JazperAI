# Models, connectors and chat visibility (2026-11-09)

## Which model Jazper uses

Only **free** models are used (a model is "free" when the FinOps price table, read from the OpenCode docs on 2026-10-21, has input and
output price 0: 13 models). Each was asked the same 12 questions with checkable answers (arithmetic, logic, reading code, strict JSON,
word problems, a classic reasoning trap, string reversal, a fact, hallucination resistance, output format, counting, instruction
following) through `POST /api/v1/llm/compare` (no fallback, so each answer really came from the model named).

| Model | Score | Median latency |
|---|---|---|
| `groq:openai/gpt-oss-120b` | **12 / 12** | 842 ms |
| `groq:openai/gpt-oss-20b` | **12 / 12** | 774 ms |
| `groq:qwen/qwen3.8-27b` (Jazper's previous model) | 8 / 12 (missed arithmetic, code reading, reversal, counting) | 423 ms |
| ten OpenCode free models | **not testable**: every call returned `429 Free usage limit reached` | - |

The test is small and easy (two models hit the ceiling), so it separates the weak model from the strong ones but does **not** rank
`120b` against `20b` beyond "both pass". `120b` is chosen for Jazper because it is the larger model with more headroom.

Routing now (Groq free tier, both keys):

* **Jazper** (`AI_MODEL` in `backend/python/.env`, and tier `frontier`): `gpt-oss-120b`, then the second key, then `gpt-oss-20b`.
* **Other agents** (tier `standard`): `gpt-oss-20b` first, `gpt-oss-120b` as backup.
* **Background/simple work** (tier `light`): `gpt-oss-20b` on the second key first (spreads rate limits); `qwen3.8-27b` last.
* The OpenCode free models are kept at the end of the `frontier`/`standard` chains so they take over once their quota resets.

### Retired models (a real bug)

Every persona agent, most routes and many seeded prompts name Groq models that no longer exist (`llama-3.1-8b-instant`,
`llama-3.3-70b-versatile`, `llama-4-scout`): requests returned **404**, so those agents failed and fell back to the weak local model.
`core/providers/ai_provider.py::resolve_model` now serves any request for a retired small model with `LIGHT_MODEL` and a retired
70B-class model with the main model. Not fixed: **Lens** (image analysis) still names `llama-4-scout`, a vision model; there is no
free vision model on Groq now, so Lens stays broken until one is chosen.

## Connectors: 8 -> 24

Added (package, version and key requirements checked against the npm registry and each README on 2026-11-09): Context7,
Sequential Thinking, Chrome DevTools, Firecrawl, Tavily, Apify, Sentry, Supabase (read-only), Stripe, HubSpot, Airtable, Todoist, Resend,
Figma, Linear and Atlassian (the last two are hosted servers through `mcp-remote` with a browser sign-in). Brave Search now uses
Brave's maintained package; the `@modelcontextprotocol` Slack/Brave/GitHub/Postgres servers are archived upstream (no security
updates), so Slack and GitHub are worth replacing next. Money-moving or outward-facing tools (Stripe refunds/invoices, Resend send)
are Tier 3 (you approve).

**All 16 new connectors are marked "untested"**: they have not been connected yet. Use Connections -> Test; the keyless ones
(Context7, Sequential Thinking, Chrome DevTools) are the easiest first check.

## Office and chat

* Floor/walls: the theme colour used to multiply the floor texture to near-black; it is now a light tint and the palette is lighter.
* People are drawn as real figures at every distance when there are 40 or fewer (animation is still throttled when far); capsule
  proxies are only used for large crowds.
* Chat now has a **Jazper performance** strip (score, average response, success rate, ratings, model, tokens, app load) from Jazper's
  recorded calls, with a "Work on next" list against targets (reply under 3 s, 98% success). It is a measurement tool: it does not by
  itself make Jazper better. Today it reports 77/100, 5.0 s average, 95% success, no ratings yet.
* `start.bat` now prefers the project venv Python (the global Python lacked `referencing`, which broke the Google Workspace check).

## Where Jazper stands vs a Grok-class assistant

Not close, and a model swap alone will not close it. Measured today: slower than target (5.0 s average vs 3 s), 5% failed calls, no
quality ratings. Likely biggest levers, in order: reliable fast model + streaming (done: model and retired-model fix), measuring answer
quality (needs ratings or an evaluation set), live web/search tools (Tavily/Brave/Firecrawl connectors, need keys), better memory and
prompt tuning.
