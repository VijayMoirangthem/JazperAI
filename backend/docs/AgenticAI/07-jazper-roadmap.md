# 07 — Jazper Agentic Roadmap

## Summary
This is the concrete implementation plan for transforming Sir Jazper from a tool-augmented chatbot into a full personal agentic AI OS. Three phases, ordered by impact and buildability.

---

## Current State Assessment

```
JAZPER TODAY
────────────────────────────────────────────────────────
✅ Chat with streaming (SSE)
✅ Tool calling (1 tool per turn)
✅ Core memory (declarative facts about Vijay)
✅ Extracted memory (keyword search)
✅ Task management (DB-backed CRUD)
✅ Job apply automation (cron-based)
✅ Dashboard (live metrics)
✅ Notifications
✅ Command Palette + Keyboard Shortcuts
✅ Session history (permanent/temporary/expiring)
✅ Voice I/O (TTS + STT)
✅ Gmail integration
✅ Settings + TTS voice selector

MISSING FOR AGENCY
────────────────────────────────────────────────────────
❌ ReAct loop (multi-step tool execution per turn)
❌ Semantic memory with vector embeddings (pgvector)
❌ Web search tool (grounding in real-world data)
❌ Sub-agent architecture (specialist delegation)
❌ Goal planner (decompose complex goals before acting)
❌ Episodic memory (agent remembers what it did)
❌ Procedural memory (learns your preferences over time)
❌ Reflexion (learns from failures)
❌ Background autonomous agents (self-initiated tasks)
```

---

## Phase 1 — Deep ReAct + Semantic Memory
**Goal:** Make Jazper actually agentic in conversation.
**Timeline:** 1-2 weeks of implementation.
**Impact:** Jazper can now handle multi-step tasks in a single turn, and actually remembers you semantically.

---

### 1.1 ReAct Loop in chat.py

**What:** Change from single tool call to N tool calls per turn.

**File:** `backend/python/app/routes/chat.py`

**Before:**
```
User message → [1 LLM call] → [0 or 1 tool] → Stream response
```

**After:**
```
User message → [LLM call] → [Tool A] → [LLM call] → [Tool B] → [LLM call] → Stream final answer
```

**Implementation sketch:**
```python
# New function: non-streaming intermediate calls + streaming final
async def run_react_chat(messages, tools, ai_provider, max_steps=10):
    for step in range(max_steps):
        response = await ai_provider.call_with_tools(messages, tools)
        
        if response.is_final:
            async for chunk in ai_provider.stream_text(response.content):
                yield chunk
            return
        
        # Execute tools, add results, loop
        messages = await execute_and_append(messages, response.tool_calls)
    
    yield "I've reached my step limit. Here's what I found so far..."
```

**Why now:** This is the single biggest impact upgrade. Every other agentic feature depends on this working.

---

### 1.2 Semantic Memory with pgvector

**What:** Add vector embeddings to memory storage and retrieval. Replace LIKE queries with cosine similarity.

**Files:**
- `backend/python/app/services/memory_service.py`
- `backend/python/main.py` (schema migration)

**Step A: Add embedding column to memories**
```sql
-- In _ensure_tables()
ALTER TABLE extracted_memories ADD COLUMN IF NOT EXISTS embedding VECTOR(768);
CREATE INDEX IF NOT EXISTS idx_memories_embedding 
    ON extracted_memories USING ivfflat (embedding vector_cosine_ops)
    WITH (lists = 100);
```

**Step B: Local embedding service**
```python
# backend/python/app/services/embedding_service.py
from sentence_transformers import SentenceTransformer

_model = None

def get_embedding_model():
    global _model
    if _model is None:
        _model = SentenceTransformer('all-MiniLM-L6-v2')  # 384-dim, fast, local
    return _model

def embed(text: str) -> list[float]:
    model = get_embedding_model()
    return model.encode(text, normalize_embeddings=True).tolist()
```

**Step C: Store with embedding**
```python
async def store_memory(content: str, session_id: str):
    embedding = embed(content)
    with _pg() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                INSERT INTO extracted_memories (content, session_id, embedding)
                VALUES (%s, %s, %s::vector)
            """, (content, session_id, embedding))
        conn.commit()
```

**Step D: Semantic retrieval**
```python
async def search_memories_semantic(query: str, limit: int = 5) -> list[str]:
    query_embedding = embed(query)
    with _pg() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT content, 1 - (embedding <=> %s::vector) AS similarity
                FROM extracted_memories
                WHERE embedding IS NOT NULL
                ORDER BY embedding <=> %s::vector
                LIMIT %s
            """, (query_embedding, query_embedding, limit))
            rows = cur.fetchall()
    # Only return above similarity threshold
    return [r[0] for r in rows if r[1] > 0.7]
```

**Package to install:**
```
pip install sentence-transformers pgvector
```

---

### 1.3 Web Search Tool

**What:** Give Jazper access to real-time internet information.

**Options:**
- **Brave Search API** — free tier (2000 queries/month), privacy-focused, simple REST API
- **SerpAPI** — Google results, free tier (100/month)
- **DuckDuckGo** — unofficial, no API key, limited

**Implementation:**
```python
# backend/python/app/tools/web_search.py
import httpx

BRAVE_API_KEY = settings.BRAVE_SEARCH_API_KEY  # Add to .env

async def search_web(query: str, max_results: int = 5) -> list[dict]:
    async with httpx.AsyncClient() as client:
        response = await client.get(
            "https://api.search.brave.com/res/v1/web/search",
            headers={"X-Subscription-Token": BRAVE_API_KEY},
            params={"q": query, "count": max_results}
        )
        results = response.json()
    
    return [
        {
            "title": r["title"],
            "url": r["url"],
            "snippet": r["description"],
            "published": r.get("age", "unknown")
        }
        for r in results.get("web", {}).get("results", [])
    ]
```

**Tool definition:**
```python
{
    "name": "search_web",
    "description": """Search the internet for current information.
    Use when: user asks about recent events, live data, specific companies/people,
    or anything that may have changed since your knowledge cutoff.
    Do NOT use for: information already in Vijay's profile or core memories,
    or for general knowledge questions you can answer directly.""",
    "input_schema": {
        "type": "object",
        "properties": {
            "query": {"type": "string", "description": "Specific search query. Use quotes for exact phrases."},
            "max_results": {"type": "integer", "default": 5}
        },
        "required": ["query"]
    }
}
```

---

### 1.4 Phase 1 Deliverables Checklist

```
□ ReAct loop implemented in chat.py (N tool calls per turn)
□ pgvector extension enabled in PostgreSQL
□ embedding column added to extracted_memories
□ sentence-transformers installed and working locally
□ embed() service function implemented
□ store_memory() stores embeddings
□ search_memories_semantic() replaces keyword search in chat context
□ Brave Search API key obtained and configured
□ search_web tool implemented and registered
□ Tool descriptions updated for all existing tools
□ Max step limit implemented with graceful fallback
□ Tool call logging working (visible in Logs panel)
```

---

## Phase 2 — Sub-Agents + Episodic Memory
**Goal:** Jazper gains specialists. Complex tasks become end-to-end.
**Timeline:** 2-4 weeks after Phase 1.
**Impact:** Jazper can coordinate multi-domain tasks. "Prepare my application for this job" becomes a one-command operation.

---

### 2.1 Sub-Agent Framework

**What:** A base class for specialist agents, reusing the same LLM infrastructure.

```python
# backend/python/app/agents/base_agent.py
class SpecialistAgent:
    def __init__(self, name: str, system_prompt: str, tools: list):
        self.name = name
        self.system_prompt = system_prompt
        self.tools = tools
    
    async def run(self, instruction: str, context: dict = None) -> str:
        messages = [
            {"role": "system", "content": self.system_prompt},
        ]
        if context:
            messages.append({"role": "user", "content": f"Context:\n{json.dumps(context)}"})
        messages.append({"role": "user", "content": instruction})
        
        return await run_react_loop(messages, self.tools, max_steps=8)
```

**Agents to build:**
```python
# backend/python/app/agents/research_agent.py
research_agent = SpecialistAgent(
    name="ResearchAgent",
    system_prompt=RESEARCH_AGENT_PROMPT,
    tools=[search_web_tool, read_url_tool]
)

# backend/python/app/agents/job_apply_agent.py  
job_agent = SpecialistAgent(
    name="JobApplyAgent",
    system_prompt=JOB_APPLY_AGENT_PROMPT,
    tools=[search_jobs_tool, read_job_tool, score_fit_tool, write_letter_tool]
)

# backend/python/app/agents/email_agent.py
email_agent = SpecialistAgent(
    name="EmailAgent",
    system_prompt=EMAIL_AGENT_PROMPT,
    tools=[read_email_tool, search_email_tool, draft_email_tool]
)
```

**Register as tools in Jazper's orchestrator:**
```python
{
    "name": "research_agent",
    "description": "Conduct deep research using web search. Returns a structured report. Use for: company research, industry news, technology comparisons, person lookup.",
    "input_schema": {
        "properties": {
            "topic": {"type": "string"},
            "focus": {"type": "string", "description": "Specific aspect to focus on"}
        }
    }
}
```

---

### 2.2 Episodic Memory

**What:** Store summaries of agent sessions and significant actions.

```sql
CREATE TABLE agent_episodes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    session_id UUID,
    episode_type TEXT NOT NULL,    -- 'chat', 'job_apply', 'research', 'task'
    summary TEXT NOT NULL,
    entities JSONB DEFAULT '[]',   -- ["TechCorp", "Python developer role"]
    outcome TEXT,                  -- 'success', 'failure', 'pending', 'in_progress'
    metadata JSONB DEFAULT '{}',
    embedding VECTOR(768),
    created_at TIMESTAMPTZ DEFAULT NOW()
);
```

**Auto-store after every significant interaction:**
```python
async def store_episode(session_id, episode_type, summary, entities=None, outcome="success"):
    embedding = embed(summary)
    db.insert("agent_episodes", 
              session_id=session_id,
              episode_type=episode_type,
              summary=summary,
              entities=json.dumps(entities or []),
              outcome=outcome,
              embedding=embedding)
```

**Retrieval for context:**
```python
# "What happened with TechCorp?"
episodes = semantic_search_episodes("TechCorp interactions", limit=5)
# Inject into context: "Past interactions: Applied to TechCorp on May 15, followed up May 20..."
```

---

### 2.3 Phase 2 Deliverables Checklist

```
□ SpecialistAgent base class implemented
□ ResearchAgent: system prompt + search_web + read_url tools
□ JobApplyAgent: upgraded from cron-only to interactive specialist
□ EmailAgent: read/search/draft using existing Gmail OAuth
□ Sub-agents registered as tools in Jazper's orchestrator
□ Parallel agent execution (asyncio.gather for independent specialists)
□ agent_episodes table created
□ Episode storage after every chat session
□ Episode semantic search working
□ Context injection: recent relevant episodes included in Jazper's context
□ Frontend: show which agents were used in a response (small tag on message)
```

---

## Phase 3 — Planner + Reflexion + Autonomous Agents
**Goal:** Jazper becomes proactively intelligent. Plans before acting. Learns from failures.
**Timeline:** 4-8 weeks after Phase 2.
**Impact:** Jazper is genuinely agentic — long-horizon tasks, self-improvement, autonomous background work.

---

### 3.1 Goal Planner

**What:** Before executing complex goals, generate an explicit plan. Execute plan step by step. Allow resumption.

```python
# backend/python/app/agents/planner.py
async def plan_goal(goal: str, context: dict) -> Plan:
    """Generate a step-by-step execution plan for a complex goal."""
    
    planning_prompt = f"""
    Goal: {goal}
    Context: {json.dumps(context)}
    
    Generate a JSON execution plan:
    {{
        "goal_summary": "One line description",
        "complexity": "simple|medium|complex",
        "steps": [
            {{
                "step_id": 1,
                "description": "What this step does",
                "agent": "jazper|research|job_apply|email|writing",
                "depends_on": [],
                "can_parallelize": true,
                "requires_confirmation": false
            }}
        ],
        "estimated_duration": "30 seconds|5 minutes|30 minutes"
    }}
    """
    
    response = await jazper_llm.call(planning_prompt, response_format="json")
    return Plan.from_dict(json.loads(response))
```

**Store plans in DB:**
```sql
CREATE TABLE agent_plans (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    session_id UUID,
    goal TEXT NOT NULL,
    plan JSONB NOT NULL,
    status TEXT DEFAULT 'pending',   -- pending, in_progress, completed, failed
    current_step INTEGER DEFAULT 0,
    results JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

**Resume after interruption:**
```python
# If a plan was interrupted, it can resume from last checkpoint
async def resume_plan(plan_id: str):
    plan = db.get("agent_plans", plan_id)
    start_from = plan.current_step
    await execute_plan(plan, start_step=start_from)
```

---

### 3.2 Reflexion — Learning from Failure

**What:** When a task fails, Jazper reflects on why and stores that as procedural memory.

```python
# backend/python/app/agents/reflexion.py
async def reflect_on_failure(goal: str, actions_taken: list, error: str):
    
    reflection_prompt = f"""
    Goal: {goal}
    Actions I took: {json.dumps(actions_taken)}
    What went wrong: {error}
    
    Analyze what I did wrong and generate a rule to avoid this in the future.
    Output JSON:
    {{
        "lesson": "What I learned",
        "rule": "Next time [trigger], I should [action] instead of [old_action]",
        "trigger": "When this type of situation occurs...",
        "applies_to": ["job_apply", "research", "general"]
    }}
    """
    
    lesson = await jazper_llm.call(reflection_prompt, response_format="json")
    
    # Store as procedural memory
    await store_procedural_memory(
        trigger=lesson["trigger"],
        rule=lesson["rule"],
        source="reflexion",
        confidence=0.7
    )
    
    log.info("Reflexion stored", lesson=lesson["lesson"])
```

---

### 3.3 Autonomous Background Agents

**What:** Jazper initiates tasks proactively without you asking. Configurable triggers.

**Examples:**
- Every morning at 8am: "Summarize overnight emails, flag interviews, show today's tasks"
- Every Monday: "Search for new job postings matching my profile, add top 5 to review list"
- When a task's due date is tomorrow: "Send me a reminder and prepare what I need"
- When a recruiter email is detected: "Draft a response, add an interview prep task"

```python
# backend/python/app/scheduler/autonomous_agents.py
from app.scheduler.scheduler import scheduler

def register_autonomous_agents():
    
    # Morning briefing
    scheduler.add_job(
        morning_briefing_agent,
        trigger='cron', hour=8, minute=0,
        id='morning_briefing', replace_existing=True
    )
    
    # Weekly job search
    scheduler.add_job(
        weekly_job_search_agent,
        trigger='cron', day_of_week='mon', hour=9,
        id='weekly_job_search', replace_existing=True
    )

async def morning_briefing_agent():
    """Runs at 8am — generates Vijay's morning briefing."""
    log.info("Morning briefing agent starting")
    
    # Run multiple lookups in parallel
    emails, tasks, calendar = await asyncio.gather(
        email_agent.run("Summarize new emails from last 12 hours. Flag interviews."),
        get_tasks_due_today(),
        get_calendar_today()
    )
    
    briefing = await jazper_llm.synthesize(
        f"Morning briefing for Vijay:\nEmails: {emails}\nTasks: {tasks}\nCalendar: {calendar}"
    )
    
    # Store as notification
    await store_notification(
        title="Good morning, Vijay — your briefing",
        body=briefing,
        type="info"
    )
```

---

### 3.4 Procedural Memory (Learning Your Preferences)

**What:** Jazper gets better at your preferences over time without you re-explaining.

**Automatic extraction:**
```python
async def extract_preferences(user_message: str, jazper_response: str, user_feedback: str):
    """Called when user edits or critiques Jazper's output."""
    
    prompt = f"""
    Jazper produced: {jazper_response}
    Vijay's feedback/edit: {user_feedback}
    
    What preference can be extracted from this feedback?
    Output JSON: {{"preference": "...", "trigger": "when ...", "rule": "always/never ..."}}
    """
    
    pref = await llm.call(prompt, response_format="json")
    await store_procedural_memory(pref["trigger"], pref["rule"], source="feedback")
```

---

## Phase 3 Deliverables Checklist

```
□ Plan generator implemented
□ agent_plans table created
□ Plan execution with checkpointing
□ Plan resumption after failure/restart
□ Reflexion: failure → lesson → procedural memory
□ Procedural memory table created
□ Procedural memories injected into system prompt
□ Preference extraction from user edits
□ Morning briefing agent (8am daily)
□ Weekly job search agent (Monday 9am)
□ Due-date reminder agent
□ Email trigger detection (recruiter emails → auto-prepare response)
□ Frontend: show plan steps in UI while executing
□ Frontend: ability to pause/resume a plan
```

---

## Architecture Target State (After All 3 Phases)

```
You
 │  "Prepare my application for this TechCorp job posting"
 ▼
┌──────────────────────────────────────────────────────────────┐
│                    JAZPER ORCHESTRATOR                       │
│                                                              │
│  1. Classify: complex multi-step goal                        │
│  2. Plan: [research TechCorp] → [score fit] → [write letter] │
│  3. Load: profile, procedural memory, relevant episodes      │
└──────────────────────┬───────────────────────────────────────┘
                       │
        ┌──────────────┼──────────────┐
        │              │              │
        ▼              ▼              │
  ┌──────────┐  ┌──────────┐         │
  │ Research │  │ Job Fit  │  (parallel)
  │  Agent   │  │  Scorer  │         │
  └────┬─────┘  └────┬─────┘         │
       │              │              │
       └──────┬────────┘             │
              ▼                      │
        ┌──────────┐                 │
        │ Writing  │  (sequential, uses research + score results)
        │  Agent   │                 │
        └────┬─────┘                 │
             │                      │
             ▼                      │
┌────────────────────────────────────┐
│         JAZPER SYNTHESIZER         │
│  Combines all results              │
│  Stores episode to memory          │
│  Creates tasks for follow-up       │
└────────────────────────────────────┘
             │
             ▼
"Here's your complete application package for TechCorp:
 - Research summary: [...]
 - Fit score: 8.5/10 (strong match on Python, FastAPI, system design)
 - Cover letter: [tailored draft]
 - Suggested: follow up in 5 days. Task created."
```

---

## Technology Stack Summary

| Component | Technology | Status |
|-----------|-----------|--------|
| LLM | Gemma via LM Studio | ✅ Running |
| Embeddings | sentence-transformers (all-MiniLM-L6-v2) | ❌ Phase 1 |
| Vector DB | pgvector (PostgreSQL extension) | ✅ Installed |
| Web search | Brave Search API | ❌ Phase 1 |
| Orchestration | Custom Python async loop | 🔜 Phase 1 |
| Sub-agents | SpecialistAgent framework | ❌ Phase 2 |
| Workflow graphs | Custom state machine | ❌ Phase 3 |
| Scheduling | APScheduler | ✅ Running |
| Memory store | PostgreSQL | ✅ Running |
| Frontend | Next.js + TypeScript | ✅ Running |

---

## Next: [08 — Interview Prep](./08-interview-prep.md)
