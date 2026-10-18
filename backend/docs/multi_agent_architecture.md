# Sir Jazper — Multi-Agent Architecture Plan

Version: 3.0  
Status: Phase 1 + Phase 2 + Phase 3 Implemented  
Author: Vijay Moirangthem  
Last Updated: June 2026

---

## 1. Why We Are Moving to Multi-Agent

The current Sir Jazper is a single AI model with many tools attached to it. This works for simple tasks but breaks down quickly:

- One model trying to search the web, read emails, track jobs, recall memories, and respond naturally — all at once — gets confused and produces mediocre results across all of them
- Tools are tightly coupled to the main chat route. Adding a new tool means editing the core chat logic
- There is no specialisation. The same model that writes casual replies is also doing structured job tracking
- Debugging is hard. When something fails, you cannot tell if it was routing, tool execution, or reasoning
- Scaling is impossible. You cannot run tasks in parallel or in the background

The solution is a **Multi-Agent Architecture** where each agent owns a specific domain, uses the most appropriate model for that domain, and communicates through a central orchestrator.

---

## 2. The New Architecture

```
User (chat, voice, vision)
        ↓
┌───────────────────────────┐
│   Sir Jazper (Orchestrator) │  ← The brain. Understands intent, delegates, assembles response
└───────────────────────────┘
        ↓ delegates to
┌──────────┬──────────┬──────────┬──────────┬──────────┬──────────┐
│  Scout   │  Hermes  │  Atlas   │   Sage   │   Lens   │ Phantom  │
│ Research │  Email   │  Jobs    │  Memory  │  Vision  │ Browser  │
└──────────┴──────────┴──────────┴──────────┴──────────┴──────────┘
        ↓ all read/write to
┌────────────────────────────────────┐
│  Shared Context Layer               │
│  Redis (session) + PostgreSQL (long-term) + MinIO (files) │
└────────────────────────────────────┘
```

Jazper never does the actual work. It reads the user's message, decides which agents to call, passes them the right context, and assembles a final response from their outputs.

---

## 3. Agent Definitions

### Jazper — Orchestrator
**Role:** Central intelligence. Routes tasks, assembles results, talks to the user.  
**Model:** `meta-llama/llama-4-scout-17b-16e-instruct` (Groq)  
**Why this model:** Needs strong multi-step reasoning to correctly decompose complex requests and know which agents to call in what order.  
**Owns:** Nothing directly. Calls other agents as tools.  
**System prompt focus:** Task decomposition, delegation, natural response assembly.  
**Does NOT:** Execute tools directly (except for simple one-liners that need no specialisation).

---

### Scout — Research Agent
**Role:** Answers any question that requires live information from the web.  
**Model:** `llama-3.1-8b-instant` (Groq)  
**Why this model:** Fast and cheap. Research tasks are mostly retrieval + summarisation, not deep reasoning.  
**Owns:** Tavily, Exa, Google CSE, DuckDuckGo, Wikipedia  
**Inputs:** A search query and optional context  
**Outputs:** A clean, cited summary  
**Examples:**
- "What is the current Python version?"
- "Find recent news about AI regulation in India"
- "What does this company do?" (when applying for jobs)

---

### Hermes — Email & Communications Agent
**Role:** Manages all Gmail interactions. Reads, drafts, sends, monitors replies.  
**Model:** `llama-3.3-70b-versatile` (Groq)  
**Why this model:** Email writing needs quality. 70B produces significantly better written output.  
**Owns:** Gmail API (read, send, reply, label, search)  
**Inputs:** An instruction + optional email context  
**Outputs:** Drafted email, email summary, inbox status  
**Examples:**
- "Check if I got any interview callbacks today"
- "Draft a follow-up email to Flipkart HR"
- "Summarise my unread emails"

---

### Atlas — Jobs & Career Agent
**Role:** Finds jobs, tracks applications, manages the entire job hunting pipeline.  
**Model:** `llama-3.3-70b-versatile` (Groq)  
**Why this model:** Complex reasoning needed for matching job requirements against the user's profile, writing tailored cover letters, and making apply/skip decisions.  
**Owns:** LinkedIn tool, Naukri scraper, job tracking DB tables, resume optimizer  
**Inputs:** Job search criteria, current resume, preferences  
**Outputs:** Ranked job list, application status updates, tailored resumes  
**Examples:**
- "Find Python developer jobs in Bangalore with 3-5 years experience"
- "Apply to this job opening"
- "How many applications did I send this week?"

---

### Sage — Memory Agent
**Role:** Stores and retrieves personal facts, preferences, and long-term context about the user.  
**Model:** `llama-3.1-8b-instant` (Groq)  
**Why this model:** Memory tasks are structured extraction and lookup — fast small model is enough.  
**Owns:** PostgreSQL semantic_memories table, pgvector embeddings, Redis short-term cache  
**Inputs:** A fact to store OR a query to recall  
**Outputs:** Relevant memories, confirmation of storage  
**Examples:**
- "Remember that I prefer remote jobs"
- "What is my notice period?"
- "What did we discuss about salary expectations last week?"

---

### Lens — Vision Agent
**Role:** Analyses images and camera frames.  
**Model:** `meta-llama/llama-4-scout-17b-16e-instruct` (Groq) — only vision-capable model available  
**Why this model:** Vision is non-negotiable here. Only Llama 4 Scout supports it on Groq free tier.  
**Owns:** Image resize pipeline, camera frame capture, base64 encoding  
**Inputs:** Image (data URI) + question  
**Outputs:** Description, text extraction, scene analysis  
**Examples:**
- "What does this image say?"
- "Describe what the camera sees"
- "Read the text on this ID card"

---

### Phantom — Browser Agent
**Role:** Automates browser actions — scraping, form filling, session management.  
**Model:** `llama-3.1-8b-instant` (Groq)  
**Why this model:** Browser tasks are mostly structured data extraction + simple instruction following. Speed matters more than quality here.  
**Owns:** Playwright, scraper tools, browser sessions, cookies  
**Inputs:** A URL + instruction  
**Outputs:** Extracted data, confirmation of action taken, screenshots  
**Examples:**
- "Scrape the job listings from this page"
- "Fill and submit this application form"
- "Take a screenshot of my Naukri profile"

---

## 3.5 — Routing Strategy (Implemented)

How Jazper decides which agents to call — without wasting tokens on every single message.

### The Problem with LLM Routing

The naive approach is asking the LLM "which agents should I call?" for every message. This adds a full LLM call (~500ms, ~100 tokens) to every request, even for "what is 2+2?" where no agents are needed at all.

### The Solution: Three-Tier Routing

```
Message arrives
      ↓
1. Keyword pre-routing (0ms, 0 tokens)
   ├── High-confidence match → call agents immediately
   ├── Low-confidence match → confirm with LLM (tier 2)
   └── No match → Jazper answers directly
      ↓
2. LLM fallback (fast 8B model, ~200ms, ~80 tokens)
   Only called when keyword match is ambiguous
   Uses llama-3.1-8b-instant, NOT the main orchestrator model
      ↓
3. Direct answer
   No agents needed — Jazper responds from its own knowledge
```

### Keyword Examples

| Message | Tier | Agent | Why |
|---|---|---|---|
| "search for Python news" | 1 (high) | Scout | "search" is a high-confidence Scout keyword |
| "check my emails" | 1 (high) | Hermes | "emails" is a high-confidence Hermes keyword |
| "what's my notice period" | 1 (high) | Sage | "what's my" is a high-confidence Sage keyword |
| "latest news" | 1 (low) → 2 | Scout | "latest" is low-confidence — could be asking Jazper directly |
| "explain recursion" | 3 | None | No keywords match — Jazper answers directly |
| "what time is it?" | 3 | None | No keywords match — Jazper answers directly |

### Result

~90% of messages route correctly via keywords with zero extra LLM calls. Only ~10% ambiguous messages pay the LLM routing cost, and even then it uses the fast 8B model, not the expensive orchestrator model.

---

## 4. Communication Pattern

### Phase 1 — Sequential (implement first)

```
User: "Find me jobs and check if I got any email replies"

Jazper:
  Step 1 → call Atlas("find Python jobs Bangalore")
         ← Atlas returns: [job1, job2, job3]
  Step 2 → call Hermes("check for interview reply emails")
         ← Hermes returns: "2 unread emails from recruiters"
  Step 3 → Jazper assembles: "Here are 3 jobs... Also, you have 2 recruiter emails..."
```

Simple. Predictable. Easy to debug. Start here.

---

### Phase 2 — Parallel (implement after Phase 1 works)

```
User: "Find me jobs and check if I got any email replies"

Jazper:
  Simultaneously:
    → call Atlas(...)  ─┐
    → call Hermes(...) ─┼→ Jazper waits for both → assembles → responds
```

Faster for multi-part requests. Requires `asyncio.gather()` coordination.

---

### Phase 3 — Background Agents (future)

Agents that run on schedules without the user asking:
- Hermes checks for new recruiter emails every 30 minutes
- Atlas refreshes Naukri profile daily
- Sage consolidates memories weekly
- Scout monitors news about companies you applied to

---

## 4.5 — Groq Free Tier Token Limits

Each Groq model has its **own independent limits** — they are NOT shared or combined across models.

| Model | Requests/min | Tokens/min | Tokens/day | Used by |
|---|---|---|---|---|
| llama-3.1-8b-instant | 30 | 6,000 | 500,000 | Scout, Hermes, Sage, Atlas, Phantom |
| llama-3.3-70b-versatile | 30 | 12,000 | **100,000** | Available as override only |
| llama-4-scout-17b-16e | 30 | 6,000 | 500,000 | Jazper (orchestrator), Lens |
| whisper-large-v3 | 20 | — | 28,800 audio-sec | Voice transcription |

### What this means in practice

- **Most requests** use `llama-3.1-8b-instant` (Scout, Hermes, Sage) — 500k tokens/day is generous for personal use
- **Every request** uses `llama-4-scout-17b` for orchestration — 500k/day, same generous limit
- **Vision requests** also use `llama-4-scout-17b` — no extra model needed
- **70B model** is intentionally avoided as a default — 100k/day runs out quickly with email-heavy use

### Hitting limits

If you hit a rate limit you'll see an error message in chat with the exact model and quota that was exceeded. To recover:
- Switch a specific agent to a different model in Settings → Agents
- Wait for the daily reset (midnight UTC)
- Upgrade to Groq paid plan ($0.05–0.09 per million tokens)

---

## 5. Shared Context Layer

All agents read from and write to the same shared context. This is what makes them feel like one system rather than isolated bots.

```
┌─────────────────────────────────────────────────────┐
│                   Shared Context                     │
│                                                      │
│  Redis:                                              │
│    session:{id}         → recent conversation        │
│    img:{id}             → last image sent            │
│    agent:{id}:{name}    → per-agent working memory   │
│                                                      │
│  PostgreSQL:                                         │
│    semantic_memories    → long-term user facts       │
│    chat_messages        → full conversation history  │
│    job_applications     → tracked applications       │
│    tasks                → background task queue      │
│                                                      │
│  MinIO:                                              │
│    resumes/             → resume versions            │
│    screenshots/         → browser captures          │
│    uploads/             → user-uploaded files        │
└─────────────────────────────────────────────────────┘
```

Key rule: **Jazper never passes raw conversation history to sub-agents.** It extracts only what each agent needs. This keeps context windows lean and agent prompts focused.

---

## 6. What Needs to Change in the Current Codebase

### Backend Changes

| Current State | What Needs to Change |
|---|---|
| Single `chat.py` route handles everything | Split into `orchestrator.py` + individual agent files |
| Tools are registered directly on Jazper | Each agent owns its tools. Jazper only sees agents as tools |
| `stream_with_tools()` in ai_provider.py handles one tool loop | Needs multi-agent routing layer above it |
| `ReAct` loop in chat.py is hardcoded (MAX_STEPS=8) | Each agent should have its own ReAct loop with its own step limits |
| Models are hardcoded per request | Agent registry maps each agent to its model |
| No agent abstraction — just functions | Create `BaseAgent` class with standardised `run()` interface |

### New Files to Create

```
backend/python/app/
├── agents/
│   ├── __init__.py
│   ├── base_agent.py          ← BaseAgent class all agents inherit from
│   ├── orchestrator.py        ← Jazper's routing logic
│   ├── scout_agent.py         ← Research
│   ├── hermes_agent.py        ← Email
│   ├── atlas_agent.py         ← Jobs
│   ├── sage_agent.py          ← Memory
│   ├── lens_agent.py          ← Vision
│   └── phantom_agent.py       ← Browser
├── registry/
│   └── agent_registry.py      ← Maps agent names to instances + models
```

### BaseAgent Interface

Every agent must implement this contract:

```python
class BaseAgent:
    name: str
    description: str        # Jazper reads this to decide when to call
    model: str              # Each agent picks its own model
    tools: list[dict]       # Tools this agent owns

    async def run(
        self,
        task: str,          # What Jazper is asking it to do
        context: dict,      # Relevant session context
        session_id: str,
    ) -> AgentResult:
        ...

@dataclass
class AgentResult:
    content: str            # The agent's response
    used_tools: list[str]   # Which tools were called
    tokens: TokenUsage      # For cost/usage tracking
    success: bool
    error: str | None
```

### Frontend Changes

| Current State | What Needs to Change |
|---|---|
| Chat shows "Searching..." for all tool use | Show which specific agent is working: "Atlas is finding jobs..." |
| No agent visibility | Add agent activity indicator in chat bubbles |
| Settings panel has one model selector | Add per-agent model override in settings |
| Token counter is session-wide | Break down tokens per agent in the tooltip |

---

## 6.5 — Agent Settings (Implemented)

Every agent is individually configurable from the Settings panel → Agents tab. Changes take effect immediately on the next message — no restart required.

### Per-Agent Controls

| Setting | What it does | Default |
|---|---|---|
| **Enabled / Disabled** | Disabled agents are never called, even if routing matches them | All core agents enabled |
| **Model override** | Swap to any Groq model for this agent. Leave blank to use the agent's built-in default | See table below |
| **Temperature** | How creative/random the agent's responses are. Lower = more precise | Agent-specific |
| **Max Tokens** | Cap how long the agent's response can be | Agent-specific |
| **Priority** | 1 (highest) to 5 (lowest). When multiple agents match a message, higher-priority agents run first | 2 |
| **System Prompt Override** | Replace the agent's built-in instructions entirely | Blank (use default) |

### Default Model Assignments

| Agent | Default Model | Tokens/Day (Groq Free) | Why |
|---|---|---|---|
| Scout | llama-3.1-8b-instant | 500,000 | Fast, cheap — search is retrieval not reasoning |
| Hermes | llama-3.1-8b-instant | 500,000 | Switched from 70B — adequate for email tasks, preserves daily quota |
| Sage | llama-3.1-8b-instant | 500,000 | Memory retrieval is structured, not creative |
| Lens | llama-4-scout-17b | 500,000 | Only Groq model with vision capability |
| Atlas | llama-3.1-8b-instant | 500,000 | Not yet active |
| Phantom | llama-3.1-8b-instant | 500,000 | Not yet active |

### Why Hermes was downgraded from 70B

`llama-3.3-70b-versatile` only has **100,000 tokens/day** on the free tier. A single complex email thread uses 2,000–3,000 tokens. That's only 40–50 interactions before hitting the daily limit. `llama-3.1-8b-instant` has 500,000 tokens/day and writes perfectly good emails. If you need higher quality for a specific email task, override the model temporarily in Settings.

---

## 7. Challenges We Will Face

### Challenge 1 — Orchestrator Accuracy
**Problem:** Jazper has to correctly decide which agent to call. If it calls the wrong agent, the whole response is wrong.  
**Mitigation:** Write extremely clear agent descriptions. Use few-shot examples in Jazper's system prompt showing which agent handles which type of request.

---

### Challenge 2 — Context Passing
**Problem:** How much context do you give each agent? Too little and they lack necessary background. Too much and you blow the context window.  
**Mitigation:** Sage (Memory Agent) becomes critical here. Before calling any agent, Jazper asks Sage for relevant context. Agents get targeted context, not the whole conversation history.

---

### Challenge 3 — Streaming with Multiple Agents
**Problem:** Currently the UI streams tokens directly. With multiple agents, you have multiple streams. The UI needs to show meaningful progress without confusion.  
**Mitigation:** Implement agent activity SSE events (`[AGENT_START]`, `[AGENT_DONE]`) so the frontend knows exactly what's happening at each step.

---

### Challenge 4 — Error Propagation
**Problem:** If Scout fails (API rate limit), does the whole response fail? Or does Jazper continue with other agents and acknowledge the failure?  
**Mitigation:** Each agent returns `AgentResult` with `success: bool`. Jazper handles partial failures gracefully and tells the user what it could and couldn't complete.

---

### Challenge 5 — Groq Rate Limits
**Problem:** Free tier is 14,400 requests/day and 500,000 tokens/day across all agents. A complex multi-agent response could call 3-4 agents, each making 2-3 LLM calls.  
**Mitigation:** Use smaller/faster models for lightweight agents (Scout, Sage, Phantom). Cache agent results in Redis where appropriate. Implement token budgeting per request.

---

### Challenge 6 — Latency
**Problem:** Sequential agent calls add latency. If each agent takes 2 seconds, a 3-agent request takes 6+ seconds.  
**Mitigation:** Parallel execution for independent agents (Phase 2). In Phase 1, set user expectations with real-time agent activity indicators so the wait feels productive.

---

### Challenge 7 — Agent Loop Depth
**Problem:** Jazper calls Atlas → Atlas calls Scout for company research → Scout calls Tavily → result. Multi-level nesting can spiral.  
**Mitigation:** Agents cannot call other agents. Only Jazper can orchestrate. Agents can only call their own tools. This is a hard rule.

---

### Challenge 8 — Testing
**Problem:** Testing a multi-agent system end-to-end is complex. A bug in Sage breaks every other agent that depends on memory retrieval.  
**Mitigation:** Each agent must be independently testable. Write unit tests that call `agent.run()` directly without going through Jazper. Mock the LLM for deterministic tests.

---

## 8. Implementation Phases

### Phase 1 — Foundation ✅ COMPLETE
**Goal:** Refactor current codebase into agent structure without breaking anything.

- [x] `BaseAgent`, `AgentResult`, `AgentTrace`, `AgentRegistry`
- [x] `ScoutAgent` (research), `HermesAgent` (email), `SageAgent` (memory), `LensAgent` (vision)
- [x] Keyword-based pre-routing (16/16 test pass) + LLM fallback for ambiguous cases
- [x] Agent SSE events: `[AGENT_START]`, `[AGENT_DONE]`, `[AGENT_TOOL]`, `[AGENT_TOOL_RESULT]`, `[ORCHESTRATOR_PLAN]`
- [x] Live agent activity bar in chat header
- [x] Agent Trace drawer per message (expandable, shows full tool call chain)
- [x] Observatory panel (Agents tab, Sessions tab, Live Feed tab)

---

### Phase 2 — Full Agent Roster ✅ COMPLETE
**Goal:** All 6 agents operational, parallel execution.

- [x] `AtlasAgent` — job applications DB, cover letters, live job search
- [x] `PhantomAgent` — web scraping (requests+BS4, Playwright fallback)
- [x] Parallel execution with `asyncio.gather()` (independent agents run simultaneously)
- [x] Per-agent token tracking in Topbar tooltip (breakdown by agent name)
- [x] Per-agent settings in Settings → Agents tab (model, temperature, max tokens, priority, system prompt override, enable/disable)
- [x] Atlas and Phantom disabled by default, enable in Settings when ready

---

### Phase 3 — Background Intelligence ✅ COMPLETE
**Goal:** Agents that work without being asked.

- [x] `HermesMonitorWorker` — AI-classified inbox scan every 30 min, smart notifications (interview invites, offers, rejections, action items)
- [x] `AtlasScheduledWorker` — Daily digest at 8:30 AM IST + weekly career report on Mondays
- [x] `ScoutMonitorWorker` — Saved topic monitoring every 6 hours, dedup by content hash, relevance check
- [x] `SageConsolidationWorker` — Weekly memory deduplication and cleanup (Sunday 2 AM UTC)
- [x] Scout topic management API (`GET/POST/DELETE /api/memory/topics`)
- [x] Dashboard live agent feed — real-time activity from both chat and background workers
- [x] All 7 workers registered in APScheduler

---

### Phase 4 — Advanced Orchestration ⚠️ IN PROGRESS
**Goal:** Jazper becomes a true autonomous orchestrator.

Tasks:
- [x] Workflow detection in chat: keyword-triggered plans for check_email, apply_jobs, web_research, send_email
- [x] Plan records created in DB + streamed to frontend as `[PLAN_CREATED]` SSE event
- [x] PlansPanel: live auto-poll every 4s while plans active; plan chip in chat bubble navigates to Plans
- [x] Human-in-the-loop approvals system (approval_service.py + ApprovalOverlay + SSE stream)
- [x] Agent bus infrastructure (agent_bus.py) in place for inter-agent events
- [ ] Per-step execution tracking (each step updates to "running"/"done" individually as agents work)
- [ ] Jazper autonomously creates plans for any arbitrary multi-step request (not just predefined workflows)
- [ ] Inter-agent messaging wired end-to-end: Hermes notifies Atlas on recruiter reply
- [ ] Voice-triggered workflows connected (workflow_service.py written; voice route not yet wired)

**Also built this phase (infrastructure):**
- [x] MinIO object storage service + REST routes (agent-avatars, documents, memories, artifacts, sessions, voice-cache, uploads)
- [x] 3D Command Center (React Three Fiber): orbit camera, dept rooms, agent spheres, click-to-inspect sidebars

---

### Phase 5 — Error Infrastructure + Self-Repair 🔒 BLOCKED on Phase 4 completion
**Goal:** The system observes its own failures in real time, diagnoses root causes, and applies targeted code fixes automatically.
See Section 15 for full design.

**Implementation order (strict):**
1. [x] per-step plan tracking — `update_plan_step_sync` in workflow_service.py + ReAct loop in chat.py
2. [x] error_store wired to all workers — `capture_current_exception` in BaseWorker.on_failure
3. [ ] Pytest suite — 20+ tests covering BaseAgent, orchestrator, workers
4. [ ] DiagnosisAgent — reads error_store, reads source file, identifies root cause
5. [ ] RepairAgent — proposes code diff, applies it, triggers QA gate
6. [ ] SentryWorker promoted — reads error_store, wakes DiagnosisAgent when threshold exceeded

---

### Phase 6 — Quality Assurance Team 🔒 BLOCKED on Phase 5
**Goal:** All self-generated code changes pass through a systematic QA gate before going live.
See Section 12 for full team design.

**Agents to build:**
- [ ] Probe (Unit Tester) — runs pytest suite, parses failures with file+line context
- [ ] Pulse (Smoke Tester) — checks all live endpoints every 15 min
- [ ] Verdict (Code Auditor) — reviews self-generated code diffs before deployment
- [ ] Aria (QA Orchestrator) — coordinates Probe+Pulse+Verdict, makes approval decision
- [ ] Post-Repair QA pipeline: RepairAgent → Verdict → Probe → Pulse → Aria → deploy
- [ ] Nightly test job via APScheduler (02:00 UTC)
- [ ] QA department room in 3D Command Center

---

### Phase 7 — Self-Create 🔒 BLOCKED on Phase 6 (needs QA gates)
**Goal:** Jazper builds new agents, tools, and workers on request — gated by the Phase 6 QA team.

**Why Phase 6 must come first:** Self-Create generates arbitrary Python code and registers it into the live system. Without Verdict and Probe, a bad generated agent could break the entire OS silently.

**Pipeline:**
- [ ] ArchitectAgent — translates user request into a detailed agent spec (schema, tools, model, department)
- [ ] BuilderAgent — writes the Python file following BaseAgent contract + writes its own test file
- [ ] Probe validates the new tests pass
- [ ] Verdict reviews the generated code for quality and safety
- [ ] Aria approves or rejects
- [ ] IntegratorAgent registers the new agent in the registry and schedules it if needed
- [ ] User confirmation prompt before the agent is made live

---

## 9. Future Vision — Next Level

These are not immediate goals. They represent what Sir Jazper can become with this foundation.

### Personalised Agent Training
Each agent builds a profile of the user over time. Atlas learns which job types get callbacks. Hermes learns writing style preferences. Scout learns trusted sources. They get better the more you use them.

### Agent-to-Agent Messaging
Hermes detects a recruiter email and proactively tells Atlas to prepare interview questions for that company. Atlas finds a perfect job and asks Sage if it matches the user's stated preferences before surfacing it.

### Autonomous Workflows
"Apply to 5 jobs per day that match my profile, but always ask me before sending anything to a FAANG company."

Jazper runs this as a background workflow. Atlas finds candidates. Jazper checks if it's FAANG. If yes, push notification to user. If no, Hermes drafts the email, Atlas applies, Sage records it.

### Desktop Agent (via Tauri)
Phantom moves beyond the browser to control the full desktop. Reads notifications, manages files, interacts with desktop apps.

### Local Model Fallback
When Groq rate limits hit, fall back to local LM Studio models automatically. Sage and Scout drop to local 3B models. Atlas and Hermes stay on cloud. The system degrades gracefully rather than failing.

### Self-Improving Prompts
Sage tracks which Jazper responses the user rated positively. Over time, Jazper's system prompt is automatically refined based on what actually works.

---

## 10. Agent Naming Reference

| Agent | Name | Domain | Model | Tier |
|---|---|---|---|---|
| Orchestrator | **Jazper** | Everything | Llama 4 Scout 17B | Primary |
| Research | **Scout** | Web search, facts | Llama 3.1 8B Instant | Fast |
| Email | **Hermes** | Gmail, comms | Llama 3.3 70B | Quality |
| Jobs | **Atlas** | Career pipeline | Llama 3.3 70B | Quality |
| Memory | **Sage** | Knowledge store | Llama 3.1 8B Instant | Fast |
| Vision | **Lens** | Images, camera | Llama 4 Scout 17B | Vision |
| Browser | **Phantom** | Automation | Llama 3.1 8B Instant | Fast |

---

## 11. Agent Activity Visualisation — Frontend

This is not optional polish. Visibility into what agents are doing is a core feature. Without it, the system is a black box — you cannot debug it, trust it, or demonstrate it to anyone.

### 11.1 — Chat Bubble Agent Indicators (Always Visible)

Every AI message in the chat already shows metadata (tokens, time, model). Extend this to show which agents were involved in producing that response.

```
┌─────────────────────────────────────────────────────┐
│ Here are 3 Python developer jobs in Bangalore...    │
│                                                     │
│  🔍 Scout  📋 Atlas  🧠 Sage                        │
│  1.2s · 843 tokens · llama-4-scout                  │
└─────────────────────────────────────────────────────┘
```

Each agent badge is clickable. Clicking opens the Agent Trace drawer (see 11.3).

---

### 11.2 — Live Agent Activity Bar (During Response)

While Jazper is processing, show a real-time activity bar in the chat header. Currently it shows "Searching..." — expand this to show exactly which agent is working and what it is doing.

```
┌────────────────────────────────────────────────────────┐
│  ⚡ Atlas  →  searching LinkedIn...                    │
│  ○ Hermes  →  waiting                                  │
│  ○ Sage    →  waiting                                  │
└────────────────────────────────────────────────────────┘
```

This is driven by new SSE events emitted from the backend:
- `[AGENT_START]{"name":"Atlas","task":"searching LinkedIn for Python jobs"}` 
- `[AGENT_DONE]{"name":"Atlas","tokens":312,"duration_ms":1840}`
- `[AGENT_ERROR]{"name":"Atlas","error":"rate limit hit"}`

The frontend listens for these and updates the activity bar in real time.

---

### 11.3 — Agent Trace Drawer (On Demand)

Every response gets an expandable **Agent Trace** — a full log of exactly what happened behind the scenes. Hidden by default, revealed by clicking the agent badges on a message or a dedicated "Trace" button.

The drawer shows the complete internal conversation:

```
┌──────────────────────────────────────────────────────────────┐
│  AGENT TRACE  ·  3 agents  ·  2.1s  ·  1,204 tokens    [×]  │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  JAZPER  →  ATLAS                                    1,840ms │
│  ┌──────────────────────────────────────────────────────┐   │
│  │ Task: Find Python developer jobs in Bangalore,       │   │
│  │ 3-5 years experience, remote preferred.              │   │
│  │ Context: User prefers startups. Notice period: 30d   │   │
│  └──────────────────────────────────────────────────────┘   │
│  ┌──────────────────────────────────────────────────────┐   │
│  │ Atlas → LinkedIn tool: "python developer bangalore"  │   │
│  │ Atlas → LinkedIn tool returned: 12 results           │   │
│  │ Atlas ranked and filtered to top 3                   │   │
│  │ Result: [job1, job2, job3] with match scores         │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                              │
│  JAZPER  →  HERMES                                     890ms │
│  ┌──────────────────────────────────────────────────────┐   │
│  │ Task: Check for recruiter reply emails in last 24h   │   │
│  └──────────────────────────────────────────────────────┘   │
│  ┌──────────────────────────────────────────────────────┐   │
│  │ Hermes → Gmail search: "from:recruiter after:today"  │   │
│  │ Hermes → 2 emails found                              │   │
│  │ Result: Flipkart HR, Zepto Tech                      │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                              │
│  JAZPER assembled final response from 2 agent results        │
│  Total: 1,204 tokens · 2.1s                                  │
└──────────────────────────────────────────────────────────────┘
```

Every row is colour-coded by agent. The exact prompts sent, tool calls made, and results received are all visible.

---

### 11.4 — Agent Observatory Panel (Dedicated Page)

A new panel in the sidebar — **Observatory** — that gives a god's-eye view of all agent activity across the entire session and across time. This is the deep-dive screen for power users.

**Sections:**

**Live Feed**
Real-time log of every agent event as they happen. Filterable by agent. Shows timestamps, token costs, tool calls. Like a terminal but for agents.

```
14:32:01  JAZPER   Received request, routing to Scout + Atlas
14:32:01  SCOUT    Starting web search: "python developer salary bangalore 2026"
14:32:03  SCOUT    Tavily returned 5 results, summarising
14:32:04  SCOUT    Done (312 tokens, 2.1s)
14:32:04  ATLAS    Starting job search on LinkedIn
14:32:06  ATLAS    Found 12 results, ranking against user profile
14:32:07  ATLAS    Done (489 tokens, 3.2s)
14:32:07  JAZPER   Assembling final response
```

**Agent Cards**
One card per agent showing its current status, total tokens used this session, number of tasks completed, average response time, and last active time.

```
┌──────────────┐  ┌──────────────┐  ┌──────────────┐
│  🔍 Scout    │  │  📋 Atlas    │  │  📧 Hermes   │
│  ● Idle      │  │  ● Working   │  │  ○ Offline   │
│  4 tasks     │  │  2 tasks     │  │  0 tasks     │
│  1,204 tok   │  │  978 tok     │  │  —           │
│  avg 1.8s    │  │  avg 3.1s    │  │  —           │
└──────────────┘  └──────────────┘  └──────────────┘
```

**Conversation Graph (Future)**
A visual node graph showing agent interactions for the current session. Jazper at the centre, agents as nodes around it, edges showing what was requested and what was returned. Built with a lightweight graph library (e.g. React Flow).

```
        [User]
           ↓
       [Jazper]
      ↙    ↓    ↘
  [Scout] [Atlas] [Sage]
              ↓
          [LinkedIn]
```

**Message Inspector**
Click any agent interaction in the Live Feed to open the full raw payload — the exact system prompt sent, the exact messages array, tool definitions, and the raw response. This is for debugging. Essential when an agent is behaving unexpectedly.

---

### 11.5 — SSE Protocol for Agent Visibility

The backend needs to emit structured events that the frontend can parse. Extend the existing SSE protocol:

| Event | Payload | Meaning |
|---|---|---|
| `[AGENT_START]` | `{"name":"Atlas","task":"...","model":"..."}` | Agent began working |
| `[AGENT_TOOL]` | `{"agent":"Atlas","tool":"linkedin","query":"..."}` | Agent called a tool |
| `[AGENT_TOOL_RESULT]` | `{"agent":"Atlas","tool":"linkedin","result_preview":"..."}` | Tool returned |
| `[AGENT_DONE]` | `{"name":"Atlas","tokens":312,"duration_ms":1840}` | Agent finished |
| `[AGENT_ERROR]` | `{"name":"Atlas","error":"..."}` | Agent failed |
| `[ORCHESTRATOR_PLAN]` | `{"steps":["Atlas","Hermes"],"reasoning":"..."}` | Jazper's routing decision |

The `[ORCHESTRATOR_PLAN]` event is particularly powerful — it tells the user (and developer) exactly why Jazper chose the agents it did. Visible in the Agent Trace drawer.

---

### 11.6 — Implementation Priority

| Feature | Priority | Effort | Value |
|---|---|---|---|
| Live agent activity bar in chat | High | Low | Immediate feedback during responses |
| Agent badges on completed messages | High | Low | Transparency at a glance |
| Agent Trace drawer (per message) | High | Medium | Full debugging capability |
| Agent cards in Observatory panel | Medium | Medium | Session-level visibility |
| Live feed log in Observatory | Medium | Medium | Power user monitoring |
| Raw message inspector | Medium | Low | Developer debugging |
| Conversation node graph | Low | High | Visual demo value, impressive for portfolio |

Build in this order. The first three should ship with Phase 1 of the multi-agent backend. The Observatory panel ships with Phase 2.

---

## 12. Quality Assurance Department

### 12.1 — Why We Need a Dedicated QA Team

As Create Origins OS becomes capable of repairing and creating its own code, a human can no longer be the sole gatekeeper for correctness. The QA team is the safety net between self-generated code and production. Without it, Self-Repair and Self-Create are reckless — a bad generated diff could silently corrupt a worker that runs unmonitored at 3 AM.

Beyond code changes, the system also needs continuous health monitoring. Twenty-plus background workers, six AI agents, five infrastructure services, and forty-plus API routes all need to be verified — not once at startup, but continuously, as the system evolves.

**Core responsibilities:**
- Gate every self-generated code change before it goes live
- Run the full test suite nightly and report failures with context
- Smoke-test all live endpoints every 15 minutes
- Generate health reports that Jazper can read and act on
- Record pass/fail history so the system learns which agents produce higher-quality code

---

### 12.2 — The QA Team

**Department:** Quality Assurance  
**Head Agent:** Aria  

| Agent | Codename | Role | Model | Level |
|---|---|---|---|---|
| QA Orchestrator | **Aria** | Coordinates all testing, decides scope, gates deployments, escalates to user | llama-3.3-70b-versatile | L4 |
| Unit Tester | **Probe** | Runs pytest suite, parses test reports, pinpoints failing lines | llama-3.1-8b-instant | L2 |
| Smoke Tester | **Pulse** | Checks all live API endpoints every 15 min, verifies service health end-to-end | llama-3.1-8b-instant | L2 |
| Code Auditor | **Verdict** | Reviews self-generated code diffs for bugs, antipatterns, and safety violations | llama-3.3-70b-versatile | L3 |

---

### 12.3 — Agent Definitions

---

#### Aria — QA Orchestrator
**Role:** Head of the QA department. Jazper calls Aria whenever a code change is proposed or a test run is requested. Aria decides what to test, assembles results from Probe, Pulse, and Verdict, and makes the final pass/fail decision.  
**Model:** `llama-3.3-70b-versatile`  
**Why this model:** Approval decisions require strong judgment — weighing a failing unit test against a passing smoke test and deciding whether to deploy or escalate. This needs the 70B model.  
**Owns:** QA pipeline orchestration, final approval gate, test run history  
**Inputs:** A code diff OR a test-run-request with scope  
**Outputs:** `{ passed: bool, gates: [...], summary: str, escalate: bool }`  
**Examples:**
- "Is everything working?" → Aria triggers Pulse + Probe and returns a system health report
- Automated: RepairAgent proposes a fix → Aria coordinates the full QA gate
- Automated: Self-Create builds a new agent → Aria runs Probe + Verdict and decides whether to register it

---

#### Probe — Unit Tester
**Role:** Runs the pytest test suite and parses the output into structured results. Reports which tests passed, which failed, which file and line the failure is on, and what the failure message was.  
**Model:** `llama-3.1-8b-instant`  
**Why this model:** Parsing pytest output is structured extraction — fast, cheap model is enough.  
**Owns:** pytest execution, test result parsing, coverage reporting  
**Inputs:** A test scope (all / specific file / specific test function)  
**Outputs:** `{ total: int, passed: int, failed: int, failures: [{ test, file, line, message }] }`  
**Examples:**
- "Run the full test suite" → Probe runs `pytest -x -q` and returns structured results
- "Test only the Hermes agent" → Probe runs `pytest tests/test_agents.py::test_hermes_smoke`
- "Did the repair break anything?" → Probe runs tests relevant to the changed file

---

#### Pulse — Smoke Tester
**Role:** Continuously verifies that all live services and API endpoints are responding correctly. Runs lightweight end-to-end checks — not deep unit tests, just "does it return 200 with reasonable content?"  
**Model:** `llama-3.1-8b-instant`  
**Why this model:** HTTP checking and result evaluation is simple. No complex reasoning needed.  
**Owns:** Live endpoint monitoring, service health checks, response validation  
**Inputs:** A set of endpoints OR "full check"  
**Outputs:** `{ healthy: bool, endpoints: [{ url, status, latency_ms, ok: bool }], down: [...] }`  
**Schedule:** Every 15 minutes via APScheduler  
**Examples:**
- Automated: checks `/health`, `/api/agents/live`, `/api/memory/core`, `/api/jobs/`, `/api/plans/` every 15 min
- "Is the backend healthy?" → Pulse runs a full endpoint check and returns a status summary
- Post-deploy: verifies a newly registered agent's endpoint responds before marking deployment complete

---

#### Verdict — Code Auditor
**Role:** Reviews code diffs produced by RepairAgent or BuilderAgent before anything is deployed. Looks for syntax errors, import errors, logic bugs, unsafe operations, deviation from codebase conventions (BaseAgent pattern, psycopg2 connection pattern, structlog usage), and security issues.  
**Model:** `llama-3.3-70b-versatile`  
**Why this model:** Code review needs strong reasoning over code context. The 70B model catches subtle bugs the 8B misses.  
**Owns:** Diff review, static analysis, convention checking, safety gate  
**Inputs:** A code diff + the original file context  
**Outputs:** `{ safe: bool, issues: [{ severity, line, description }], approved: bool }`  
**Examples:**
- "Is this repair diff safe?" → Verdict reads the diff and flags any issues
- "Does this new agent follow the BaseAgent contract?" → Verdict checks the structure against the codebase pattern
- Automated: any self-generated code file passes through Verdict before registration

---

### 12.4 — QA Gates

Every automated code change passes through three sequential gates. **All three must pass before anything goes live.** A human approval prompt is added for high-risk changes (schema changes, auth changes, new tool registrations).

```
Code change proposed
        ↓
┌─────────────────────────────────────────┐
│  Gate 1: VERDICT                        │
│  Verdict reads the diff.                │
│  Flags: syntax, antipatterns, safety    │
│  → Pass: no CRITICAL issues             │
│  → Fail: escalate to user               │
└─────────────────────────────────────────┘
        ↓ (only if Gate 1 passes)
┌─────────────────────────────────────────┐
│  Gate 2: PROBE                          │
│  Probe runs relevant pytest tests.      │
│  → Pass: 0 failures                     │
│  → Fail: escalate to user with details  │
└─────────────────────────────────────────┘
        ↓ (only if Gate 2 passes)
┌─────────────────────────────────────────┐
│  Gate 3: PULSE                          │
│  Pulse checks affected live endpoints.  │
│  → Pass: all return 200                 │
│  → Fail: escalate to user               │
└─────────────────────────────────────────┘
        ↓ (all gates passed)
┌─────────────────────────────────────────┐
│  ARIA: Final approval                   │
│  Aria reads all gate results.           │
│  Routine change → auto-approve          │
│  High-risk change → ask user            │
└─────────────────────────────────────────┘
        ↓
   DEPLOYED / REGISTERED
```

---

### 12.5 — Integration with Self-Repair and Self-Create

**Self-Repair pipeline (after Phase 5a):**
```
Error detected → DiagnosisAgent identifies root cause
              → RepairAgent proposes a code diff
              → Verdict: "Is this diff safe to apply?"
              → Probe: "Do tests still pass with this fix?"
              → Pulse: "Is the affected endpoint still healthy?"
              → Aria: all gates passed → auto-apply
                      any gate failed → push approval to user
              → Fix goes live (or user reviews)
              → error_store marks error as resolved
```

**Self-Create pipeline (after Phase 7):**
```
User: "Build an agent that monitors my LinkedIn connection requests"
   → ArchitectAgent designs the spec
   → BuilderAgent writes the Python file + test file
   → Probe: "Do the new tests pass?"
   → Verdict: "Does the code follow BaseAgent contract and have no bugs?"
   → Pulse: (after registration) "Does the new endpoint respond?"
   → Aria: all gates passed → ask user for final confirmation
   → User approves → IntegratorAgent registers + schedules
   → New agent is live
```

**Continuous QA schedule (APScheduler):**

| Job | Frequency | Owner |
|---|---|---|
| Smoke test all endpoints | Every 15 min | Pulse |
| Full pytest suite | Nightly 02:00 UTC | Probe |
| Weekly health report | Monday 06:00 UTC | Aria |
| Alert on consecutive Pulse failures | Immediate | Aria → push notification |

---

### 12.6 — QA Dashboard (Command Center integration)

The 3D Command Center gets a QA wing. The Quality Assurance department room in the Command Center shows:

- **Aria** sphere: pulsing green when a gate is actively running, red when a gate failed
- **Probe** sphere: animated when pytest is running
- **Pulse** sphere: slow pulse every 15 min when performing health checks
- **Verdict** sphere: activated when a code review is in progress

Clicking the QA room opens a sidebar showing the last test run results, last smoke test summary, and any active QA gates running right now.

---

### 12.7 — Why This Team Matters for the Long Term

Without Aria and the QA team:
- Self-Repair could apply a "fix" that makes things worse and no one notices for hours
- Self-Create could register a new agent with a logic error that burns through Groq quota silently
- Background workers could fail silently and you'd only notice when you try to use a feature that depends on them

With Aria and the QA team:
- Every code change is verified before it touches production
- Failures are caught within minutes, not hours
- The system can self-diagnose problems: "Probe says test_hermes_parse is failing. Verdict says the recent Hermes change introduced a type error on line 47. Repair proposed."
- You can ask Jazper "is everything working?" and get a real, current answer — not a guess

This is what transforms Create Origins OS from a smart tool into a self-maintaining system.

---

## 13. Guiding Principles for This Transition

1. **Agents cannot call other agents.** Only Jazper orchestrates. This prevents infinite loops and makes debugging tractable.

2. **Each agent is independently testable.** If you cannot call `agent.run()` directly, the agent is not properly isolated.

3. **Jazper's job is routing, not doing.** If Jazper is doing actual work (searching, writing, recalling), something is architecturally wrong.

4. **Fail gracefully.** A partial response with one failed agent is better than a complete failure. Always tell the user what happened.

5. **Context is expensive.** Never pass the full conversation history to a sub-agent. Extract only what it needs.

6. **Model choice is a performance decision, not a preference.** Use the smallest model that gets the job done reliably. Upgrade only when quality is genuinely insufficient.

7. **Streaming is non-negotiable.** Users should see progress in real time. Every agent should emit SSE events as it works, not just when it finishes.

---

## 15. Phase 5 — Self-Repair & Self-Create (Design Document)

**Status:** Discussed. Not yet implemented. This is the roadmap for when Phase 4 is complete.

---

### 15.1 — What These Mean (Precisely)

These two features sound similar but are fundamentally different problems:

**Self-Repair** = Jazper detects that something is broken at runtime, diagnoses the root cause, proposes or executes a fix, and verifies the fix worked — without you having to intervene.

**Self-Create** = Jazper writes new code (a new agent, tool, or API route), integrates it into the existing codebase, tests it, and deploys it — in response to a natural language request from you.

Both require the system to have awareness of its own code, its own execution state, and the ability to modify itself safely.

---

### 15.2 — Self-Repair: How It Would Work

**The core loop:**

```
1. Error detected (exception, failed health check, timeout, bad output)
        ↓
2. Diagnosis Agent reads the error + relevant source files
        ↓
3. Diagnosis Agent identifies the root cause
        ↓
4. Repair Agent proposes a fix (code diff)
        ↓
5. Human confirmation (for production) OR auto-apply (for dev mode)
        ↓
6. Fix applied, tests run, result verified
        ↓
7. If verified → notify user. If not → escalate to human.
```

**What triggers it:**
- Unhandled exceptions in any agent or worker
- An agent returning `success=False` more than N times in a row
- A scheduled worker timing out
- Health check failures (DB connection, API rate limits)
- A chat response that contains an error message instead of content

**What it actually does:**
- Reads the relevant Python file(s)
- Reads the traceback
- Asks an LLM: "Here is the error. Here is the code. What is wrong and how do I fix it?"
- Gets back a diff
- Applies the diff (with rollback capability)
- Re-runs a smoke test
- Reports the outcome

**What it does NOT do:**
- Autonomously push to production
- Modify database schemas
- Delete data
- Change authentication or credentials

**Key technical requirement:** The system needs a `CodeReaderTool` (reads specific files) and a `CodeWriterTool` (applies diffs with backup). Both already exist conceptually — Phantom can read files, and file writes are trivially implementable.

**The hard part:** Knowing WHEN to repair vs when to escalate. The rule: if the same fix has been attempted before and failed, escalate to the user. Never retry the same repair twice.

**Do we need a separate AI for this?**

No — same Groq models work. The Diagnosis Agent uses `llama-3.3-70b-versatile` (needs strong reasoning). The actual fix is small enough that `llama-3.1-8b-instant` can apply it. What matters is the context: the agent must read the actual source files, not rely on training data.

---

### 15.3 — Self-Create: How It Would Work

This is significantly harder. It means Jazper can build a new feature from a description.

**Example trigger:**
> "Jazper, I want you to start monitoring my LinkedIn connection requests and tell me when someone interesting connects."

**What happens:**

```
1. Jazper understands: this is a new monitoring task
        ↓
2. Architect Agent reads existing agent structure (BaseAgent, registry)
        ↓
3. Architect generates: new agent spec (name, tools, schedule, prompt)
        ↓
4. Builder Agent writes: the Python file for the new agent
        ↓
5. Builder Agent writes: the test file
        ↓
6. Tester Agent runs tests, checks for syntax errors, import errors
        ↓
7. If tests pass → Integrator adds to registry + scheduler
        ↓
8. Human confirmation → deploy
        ↓
9. New agent is live. Jazper tells you it's running.
```

**The agents needed:**
- **Architect** — understands what's being asked and designs the spec
- **Builder** — writes the actual Python code based on the spec
- **Tester** — runs the code, catches errors, requests fixes
- **Integrator** — registers the agent, adds it to the scheduler if needed

This is essentially a mini software development lifecycle automated.

**What makes this possible today:**
- The codebase has clean patterns (BaseAgent is a simple contract)
- Every agent follows the same structure (tools, emit, run)
- The scheduler is DB-driven (new workers self-register)
- Groq models can write valid Python

**What makes this hard:**
- The generated code might work in isolation but break something else
- Testing is the bottleneck — you need a real test runner, not just syntax checks
- The Builder needs deep codebase context (which files exist, what patterns to follow)
- Rollback if something goes wrong

**The honest limitation:** LLMs write plausible code, not always correct code. The Tester agent is the most critical piece. Without robust testing, Self-Create is dangerous in a production system.

---

### 15.4 — Do You Need a Different AI for This?

No — but you need the right models for the right roles:

| Role | Model | Why |
|---|---|---|
| Error diagnosis | llama-3.3-70b (Groq) | Needs strong reasoning over code + traceback |
| Fix generation | llama-3.3-70b (Groq) | Code quality matters |
| Architecture design | llama-4-scout-17b (Groq) | Long context needed to read full codebase |
| Code writing | llama-3.3-70b (Groq) | Best code generation available free |
| Test validation | llama-3.1-8b-instant | Simple pass/fail evaluation |

All on Groq free tier. The constraint is the **70b daily limit (100k tokens)**. Self-Create is expensive — a full agent creation cycle might use 5,000–10,000 tokens. You get ~10–20 creation cycles per day on the free tier.

If this becomes heavily used, switch the Builder and Architect to Groq's paid tier or use a local code model (DeepSeek Coder, Qwen2.5-Coder).

---

### 15.5 — Should We Build This Now?

**Short answer: No. Not yet.**

**Why not now:**

1. **Phase 4 isn't done.** Self-Repair requires robust error detection infrastructure (Phase 4 health monitoring). Self-Create requires the agent registry to be battle-tested (it is, but it needs real-world use first).

2. **Self-Repair is only useful if you have errors you can't fix manually.** Right now the codebase is small enough that you can debug it yourself. Self-Repair becomes valuable when the system is running 24/7 with background workers you're not watching.

3. **Self-Create without tests is reckless.** We don't have a test suite yet. Building Self-Create before having proper tests is building on sand.

4. **You're still the best debugger for this codebase.** You know the code, the patterns, and the intent. The AI doesn't know the WHY behind decisions yet. Sage needs more time to learn your context before it can write code that fits your style.

**When to build it:**

- **Self-Repair:** After Phase 4 is complete, when background agents are running daily and you've seen real production errors. Build it as a `DiagnosisAgent` that monitors the logs and proposes fixes.

- **Self-Create:** After you have a proper test suite, after Self-Repair is working, and after you've had to build 3-4 agents manually and found the pattern truly repetitive. By that point, the Builder Agent will have real examples to follow.

**The right order:**
```
Phase 4 (Advanced Orchestration)
        ↓
Add test suite (pytest coverage)
        ↓
Self-Repair (DiagnosisAgent + RepairAgent)
        ↓
Self-Create (ArchitectAgent + BuilderAgent + TesterAgent)
        ↓
True self-improving system
```

---

### 15.6 — What Self-Learning Actually Means

Both features together enable a feedback loop:

```
System runs → Error occurs → Self-Repair fixes it → Sage records what was fixed
                ↓
User requests feature → Self-Create builds it → Sage records what was built
                ↓
Next time similar error/request occurs → Sage recalls the previous solution
                ↓
System gets faster at fixing/building over time
```

This is not AGI. It's pattern-matching over a well-structured codebase with good tooling. But it feels like self-learning because the system genuinely improves from experience stored in Sage's memory.
