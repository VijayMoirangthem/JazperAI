# 06 — Multi-Agent Systems

## Summary
A multi-agent system is a network of AI agents where each has a specialized role. Jazper is the Orchestrator — it receives your goals, plans, and delegates to specialist sub-agents. Sub-agents are not separate AI models — they're the same LLM with different system prompts, each focused on a narrow domain.

---

## 1. The Core Analogy

Think of a well-run company:

```
YOU (The Executive)
    │
    ▼
JAZPER (CEO / Chief of Staff)
    │
    ├── ResearchAgent      (Research Department)
    ├── JobApplyAgent      (Recruiting/HR Department)
    ├── EmailAgent         (Communications Department)
    ├── WritingAgent       (Marketing/Content Department)
    └── SchedulerAgent     (Operations/Calendar Department)
```

You don't micromanage every department. You tell Jazper "prepare a job application for this role." Jazper figures out that it needs research on the company, a tailored cover letter, and a submission — and dispatches each to the right specialist.

The CEO (Jazper) coordinates. Departments (sub-agents) execute. You just see the final result.

---

## 2. Why Multiple Agents?

**Problem with one monolithic agent:**
1. **Context bloat**: All tools + all knowledge crammed into one context window
2. **Focus degradation**: When an agent tries to be good at everything, it's excellent at nothing
3. **Tool confusion**: 20+ tools → model gets confused about which to use
4. **Parallel execution**: One agent works sequentially; multiple agents can work simultaneously
5. **Maintainability**: When the job apply workflow breaks, you fix the JobApplyAgent without touching Jazper

**What specialization buys you:**
- Each agent's context only contains what it needs
- Each agent can be tuned, tested, and improved independently
- Multiple agents can run in parallel on sub-tasks
- Failure in one specialist doesn't crash the whole system

---

## 3. Agent Roles in Jazper

### 3.1 Jazper — The Orchestrator

```python
JAZPER_SYSTEM_PROMPT = """
You are Sir Jazper, Vijay Moirangthem's personal AI operating system.

Your role is ORCHESTRATOR. When Vijay gives you a goal:
1. Determine if you can answer directly from memory
2. If not, identify which specialist(s) to call
3. Synthesize their outputs into a final response
4. Store anything important to memory

You have access to these specialists via tools:
- research_agent(topic): Deep research, web search, document analysis
- job_apply_agent(instruction): Job searching and application management  
- email_agent(instruction): Gmail reading and drafting
- writing_agent(instruction, context): Long-form content generation

Always respond in Vijay's preferred style: direct, specific, actionable.
"""
```

**Orchestrator's job:**
- Receive user goals
- Classify complexity (direct answer vs. needs tools vs. needs agents)
- Generate a plan for complex tasks
- Dispatch to specialists
- Handle failures (retry, reroute, escalate)
- Synthesize all results
- Respond to user
- Update memory

### 3.2 ResearchAgent — The Researcher

```python
RESEARCH_AGENT_PROMPT = """
You are a research specialist. Your only job is deep, accurate research.

Given a research topic or question, you:
1. Search the web for current information
2. Read the most relevant sources
3. Cross-reference facts across multiple sources
4. Synthesize findings into a structured report
5. Always cite your sources

You output ONLY structured research reports, never opinions or recommendations.
Format: Summary → Key Facts → Sources → Caveats

Tools available: search_web, read_url, extract_document
"""
```

### 3.3 JobApplyAgent — The Job Hunter

```python
JOB_APPLY_AGENT_PROMPT = """
You are a job application specialist for Vijay Moirangthem.

You know Vijay's full profile: skills, experience, target roles, preferences.
Your job is to maximize the quality and success rate of applications.

Tasks you handle:
- Searching job boards with Vijay's criteria
- Scoring job fitness against his profile
- Tailoring resumes for specific roles
- Writing targeted cover letters (lead with specific achievement)
- Tracking application status
- Drafting follow-up emails

Tools: search_jobs, read_job_description, read_profile, write_cover_letter,
       track_application, search_email_for_response
"""
```

### 3.4 EmailAgent — The Communications Manager

```python
EMAIL_AGENT_PROMPT = """
You are Vijay's email manager.

You read, categorize, and draft emails. You NEVER send emails without explicit
Vijay approval — you always present drafts first.

Tasks:
- Read and summarize new emails
- Flag urgent messages (interviews, deadlines)
- Draft replies in Vijay's voice (direct, professional)
- Categorize threads (job search, personal, work, financial)
- Find specific emails when Vijay needs them

Tools: read_email, search_email, draft_email, label_email
"""
```

### 3.5 WritingAgent — The Content Creator

```python
WRITING_AGENT_PROMPT = """
You are a specialized writing agent for long-form content.

You produce: cover letters, LinkedIn posts, technical blog posts, summaries,
reports, and personal statements.

Style guide for Vijay:
- Direct and confident, not defensive
- Lead with impact/achievement, not intention
- Prefer specific over generic (numbers, names, outcomes)
- Never use filler phrases like "I am excited to apply"

You always produce 2-3 variations for the user to choose from.
"""
```

---

## 4. How Orchestration Works

### Simple case: Direct answer
```
User: "What are my pending tasks?"
Jazper: Checks memory → Queries task DB directly → Answers
No sub-agents needed.
```

### Medium case: Single specialist
```
User: "Find me Python backend jobs that are remote and posted this week"
Jazper: Recognizes this as a job search task
Jazper: Calls job_apply_agent("Search: Python backend, remote, posted this week, fit Vijay's profile")
JobApplyAgent: Searches 3 job boards, filters, scores, returns top 5
Jazper: Formats and presents results
```

### Complex case: Multiple specialists in sequence
```
User: "Prepare a complete application package for this job: [URL]"

Jazper plan:
Step 1: research_agent("TechCorp company background, culture, recent news")
Step 2: job_apply_agent("Score this role against Vijay's profile")
Step 3: writing_agent("Draft cover letter for TechCorp role with research context")
Step 4: Jazper synthesizes and presents the package

[Step 1 and 2 can run in parallel]
[Step 3 needs Step 1+2 results]
```

### Complex case: Multiple specialists in parallel
```
User: "What's my week looking like? Any job responses? Urgent tasks?"

Jazper recognizes 3 separate questions — runs simultaneously:
├── email_agent("Find interview or recruiter responses from this week")
├── task_db_query("overdue or due this week tasks")
└── calendar_query("this week's schedule")

Jazper synthesizes all 3 results → weekly briefing
```

---

## 5. Implementation Patterns

### Pattern 1: Agent as Tool (Simplest)

Each sub-agent is just a tool the orchestrator can call. The tool internally runs an LLM with a specialized prompt.

```python
# Registered with the orchestrator as a tool
{
    "name": "research_agent",
    "description": "Conduct deep research on any topic. Returns a structured report with sources. Use this when you need current, accurate information about a company, person, technology, or topic.",
    "input_schema": {
        "properties": {
            "topic": {"type": "string"},
            "depth": {"type": "string", "enum": ["quick", "thorough"], "default": "quick"}
        }
    }
}

# Implementation
async def research_agent(topic: str, depth: str = "quick") -> dict:
    messages = [
        {"role": "system", "content": RESEARCH_AGENT_PROMPT},
        {"role": "user", "content": f"Research: {topic}\nDepth: {depth}"}
    ]
    
    # Sub-agent runs its own tool loop
    result = await run_react_loop(
        messages=messages,
        tools=RESEARCH_TOOLS,  # search_web, read_url, extract_document
        max_steps=5
    )
    
    return {"report": result, "agent": "research", "topic": topic}
```

### Pattern 2: Supervisor with Worker Review

The orchestrator doesn't just dispatch — it reviews sub-agent outputs and can reject/retry.

```python
async def supervised_research(topic: str) -> str:
    # Sub-agent produces output
    draft_report = await research_agent(topic)
    
    # Orchestrator evaluates
    quality_check = await jazper_llm.evaluate(
        f"Is this research report accurate, complete, and well-sourced? "
        f"Report: {draft_report}\n"
        f"If not, specify what's missing."
    )
    
    if quality_check.is_acceptable:
        return draft_report
    else:
        # Retry with specific guidance
        return await research_agent(topic, additional_context=quality_check.feedback)
```

### Pattern 3: LangGraph-Style State Machine

For complex workflows, model the process as a graph of states:

```
START
  │
  ▼
[Classify Intent]
  │
  ├── "research" ──► [ResearchNode] ──► [SynthesizeNode] ──► END
  │
  ├── "job apply" ──► [ProfileNode] ──► [SearchNode] ──► [ScoreNode] ──► [WriteNode] ──► END
  │
  └── "email" ──► [ReadEmailNode] ──► [DraftNode] ──► [ConfirmNode] ──► END
```

Each node is an agent. The graph defines the workflow. State is passed between nodes.

```python
class AgentState:
    goal: str
    intent: str
    sub_results: dict
    final_response: str
    requires_confirmation: bool

async def run_workflow(state: AgentState) -> AgentState:
    state.intent = await classify_intent(state.goal)
    
    if state.intent == "job_apply":
        state = await profile_node(state)
        state = await search_node(state)
        state = await score_node(state)
        state = await write_node(state)
    
    elif state.intent == "research":
        state = await research_node(state)
        state = await synthesize_node(state)
    
    return state
```

---

## 6. Communication Between Agents

### 6.1 Direct Function Call (Jazper's approach)
```python
result = await research_agent(topic="TechCorp")
```
Synchronous from the orchestrator's perspective. Simple, easy to debug.

### 6.2 Shared Database (Already in Jazper)
Agents share state via PostgreSQL:
```
Jazper writes plan → job_apply_agent reads plan → updates status → Jazper reads status
```
Decoupled, persistent, easy to inspect.

### 6.3 Message Queue (For truly async agents)
```python
# Jazper enqueues work
queue.put({"agent": "job_apply", "task": "apply_to_top_5", "run_id": 123})

# JobApplyAgent consumes from queue (runs independently)
while True:
    task = queue.get()
    result = await process(task)
    queue.put_result(task.run_id, result)

# Jazper checks result later
result = queue.get_result(run_id=123)
```

This is how Jazper's APScheduler-based cron agents work today.

---

## 7. Shared Memory in Multi-Agent Systems

All Jazper agents share the same PostgreSQL database. This is the "single source of truth":

```
┌──────────────────────────────────────────────┐
│                PostgreSQL                    │
│                                              │
│  core_memories ──────────────────────────── │◄── All agents read
│  extracted_memories ─────────────────────── │◄── All agents read/write  
│  tasks ──────────────────────────────────── │◄── Jazper writes, agents check
│  job_applications ───────────────────────── │◄── JobApplyAgent writes
│  chat_sessions ──────────────────────────── │◄── Jazper reads for context
│  agent_episodes ─────────────────────────── │◄── All agents write
│  procedural_memories ────────────────────── │◄── All agents read
└──────────────────────────────────────────────┘
```

**Consistency rule:** Each agent is responsible for writing to its own domain. Reading is unrestricted.

---

## 8. Multi-Agent Failure Modes

### 8.1 Orchestration loops
Agent A calls Agent B which calls Agent A. Prevent with:
- Call depth tracking
- Circular dependency detection
- Max recursion limit

### 8.2 Context loss between agents
Agent A does research but Agent B doesn't know about it.
Fix: Pass context explicitly in each agent call:
```python
await writing_agent(
    instruction="Write a cover letter",
    context={
        "research": research_result,
        "job_score": score_result,
        "user_profile": profile
    }
)
```

### 8.3 Conflicting decisions
Two agents give contradictory recommendations.
Fix: Orchestrator always synthesizes — it's the final decision maker.

### 8.4 Partial failures
One agent in a 4-step workflow fails on step 3.
Fix: Checkpoint state after each step. Resume from checkpoint, don't restart.

---

## 9. Jazper Multi-Agent Architecture (Target State)

```python
# Jazper orchestrator decision flow
async def jazper_orchestrate(user_message: str, session_id: str):
    
    # 1. Load context
    profile = await get_user_profile()
    memories = await semantic_search(user_message)
    history = await get_session_history(session_id)
    
    # 2. First LLM pass: classify and plan
    plan = await jazper_llm.plan(
        goal=user_message,
        context={"profile": profile, "memories": memories}
    )
    # plan = {
    #   "can_answer_directly": False,
    #   "agents_needed": ["research", "job_apply"],
    #   "parallel_steps": [["research"], ["job_apply"]],  
    #   "sequential_steps": [["synthesize"]],
    #   "requires_confirmation": False
    # }
    
    # 3. Execute plan
    results = {}
    
    # Run parallel steps concurrently
    for parallel_group in plan.parallel_steps:
        group_results = await asyncio.gather(*[
            AGENT_REGISTRY[agent](context=plan.context) 
            for agent in parallel_group
        ])
        results.update(zip(parallel_group, group_results))
    
    # Run sequential steps in order
    for step in plan.sequential_steps:
        results[step] = await AGENT_REGISTRY[step](
            context={**plan.context, **results}
        )
    
    # 4. Synthesize
    final_response = await jazper_llm.synthesize(
        goal=user_message,
        agent_results=results,
        user_profile=profile
    )
    
    # 5. Store episode
    await store_episode(user_message, plan, results, final_response)
    
    return final_response
```

---

## 10. Key Interview Concepts

**Agent topology:** The graph structure of how agents connect — linear, tree, mesh, hub-and-spoke.

**Orchestrator pattern:** One central agent coordinates all others. Clear hierarchy, easier to debug.

**Emergent behavior:** In multi-agent systems, the combined behavior is more capable than any single agent. The whole is greater than the sum.

**Agent handoff:** When one agent transfers control to another. Includes passing relevant context.

**Shared state vs. message passing:** Two architectural philosophies. Shared state (Jazper's approach) is simpler but requires careful coordination. Message passing is more decoupled and scalable.

**Human-in-the-loop (HITL):** A design principle where agents pause and request human approval for high-stakes actions. Not a limitation — a feature for trust and safety.

**Agent swarm:** Multiple identical agents working on different instances of the same task in parallel. E.g., 5 ResearchAgents each researching a different company simultaneously.

**LangGraph:** A framework for building multi-agent workflows as state machine graphs. Each node is an agent, edges define flow, state is passed through. Used in production at many companies.

---

## Next: [07 — Jazper Agentic Roadmap](./07-jazper-roadmap.md)
