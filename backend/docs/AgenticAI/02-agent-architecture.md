# 02 — Agent Architecture

## Summary
Every agent is built from the same five components: LLM Brain, Memory, Tools, Orchestration Logic, and an Environment interface. Understanding how these connect is the foundation of designing any agentic system.

---

## 1. The Five Components

```
┌────────────────────────────────────────────────────────────┐
│                        AGENT                               │
│                                                            │
│  ┌──────────────┐    ┌──────────────┐    ┌─────────────┐  │
│  │   PERCEPTION │    │     LLM      │    │   ACTION    │  │
│  │              │───▶│    BRAIN     │───▶│  EXECUTOR   │  │
│  │ • User input │    │              │    │             │  │
│  │ • Tool output│    │ • Reasoning  │    │ • Tool call │  │
│  │ • Memory read│    │ • Planning   │    │ • Sub-agent │  │
│  │ • State      │    │ • Deciding   │    │ • Response  │  │
│  └──────────────┘    └──────┬───────┘    └──────┬──────┘  │
│          ▲                  │                   │         │
│          │           ┌──────▼───────┐           │         │
│          │           │    MEMORY    │           │         │
│          │           │              │           │         │
│          │           │ • Working    │           │         │
│          │           │ • Episodic   │           │         │
│          │           │ • Semantic   │           │         │
│          │           └──────────────┘           │         │
│          │                                      │         │
│  ┌───────┴──────────────────────────────────────▼──────┐  │
│  │                   ENVIRONMENT                       │  │
│  │  Web │ Database │ APIs │ File System │ Other Agents │  │
│  └─────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────┘
```

---

## 2. Component Deep Dives

### 2.1 The LLM Brain

This is the "thinking" component. In Jazper, it's Gemma running in LM Studio.

**What it actually does:**
- Takes a sequence of messages (context) as input
- Generates either: (a) a final text response, OR (b) a tool call specification
- Has no memory of its own — everything must be injected into the context

**Key insight:** The LLM is stateless. Every call starts fresh. The illusion of memory and continuity comes entirely from what you inject into the messages array. This is why the architecture around the LLM — how you build and manage context — is more important than the model itself.

**Context window as working memory:**
```
[System Prompt]           ← Who am I? What are my rules?
[Core Memories]           ← What do I know about Vijay?
[Relevant Past]           ← What's relevant from past conversations?
[Available Tools]         ← What can I do?
[Conversation History]    ← What's happened in this session?
[Current Message]         ← What does Vijay want now?
[Tool Results]            ← What did my last action return?
```

All of this is "injected" on every LLM call. Managing what goes in and what gets trimmed is called **context engineering** — one of the most important skills in agentic AI.

### 2.2 Memory

Covered in depth in [04 — Memory Systems](./04-memory-systems.md). Quick overview:

- **Working memory**: The current context window — short-lived, expensive per token
- **Episodic memory**: "What happened" — stored events, actions, outcomes
- **Semantic memory**: Facts and knowledge — stored as embeddings, retrieved by similarity
- **Procedural memory**: How to do things — learned workflows and preferences

### 2.3 Tools

Covered in depth in [05 — Tools & Tool Loops](./05-tools-and-tool-loops.md). Quick overview:

Tools are functions with a name, description, and JSON schema for parameters. The LLM reads the description and decides when to call a tool and with what arguments. Your code executes the actual function and returns the result.

```python
# Tool definition (what the LLM sees)
{
  "name": "search_web",
  "description": "Search the internet for current information about a topic",
  "parameters": {
    "query": {"type": "string", "description": "The search query"},
    "max_results": {"type": "integer", "default": 5}
  }
}

# Tool implementation (what your code runs)
def search_web(query: str, max_results: int = 5) -> list[dict]:
    results = brave_search_api(query, limit=max_results)
    return [{"title": r.title, "snippet": r.snippet, "url": r.url} for r in results]
```

### 2.4 Orchestration Logic

This is the code (not the LLM) that manages the loop:

```python
async def agent_loop(goal, tools, memory, max_steps=10):
    messages = build_context(goal, memory)
    
    for step in range(max_steps):
        response = await llm.call(messages, tools=tools)
        
        if response.stop_reason == "end_turn":
            # Agent decided it's done
            await memory.store_episode(goal, messages, response)
            return response.content
        
        if response.stop_reason == "tool_use":
            # Execute the tool
            tool_result = await execute_tool(response.tool_calls)
            
            # Add to message history
            messages.append({"role": "assistant", "content": response.content})
            messages.append({"role": "tool", "content": tool_result})
            # Loop continues
    
    # Max steps reached — force a final answer
    return await llm.summarize(messages, "You've hit your step limit. Summarize what you found.")
```

The orchestration logic handles:
- Building and trimming context
- Executing tool calls
- Error handling and retries
- Detecting infinite loops
- Enforcing step limits
- Escalating to human when needed

### 2.5 Environment

Everything outside the agent that it can interact with:
- **Internal**: Your own PostgreSQL, file system, internal APIs
- **External**: Web search, email APIs, third-party services
- **Other agents**: Sub-agents in a multi-agent system

---

## 3. Agent Types by Architecture

### 3.1 Simple Reflex Agent
Responds to current input only. No memory, no planning.
```
Input → [If-Then Rules] → Output
```
*Analogy: A thermostat.*

### 3.2 Model-Based Agent
Maintains internal state (a model of the world) and acts based on that.
```
Input + State → [Rules + World Model] → Action → Updated State
```
*Analogy: A chess player who remembers the board.*

### 3.3 Goal-Based Agent
Has an explicit goal. Evaluates actions by how they contribute to achieving it.
```
Goal + State → [Planning] → Action sequence → Goal achieved?
```
*Analogy: A GPS navigation system.*

### 3.4 Utility-Based Agent
Assigns scores to possible outcomes and maximizes expected utility.
```
Goals + State → [Utility function] → Best action
```
*Analogy: A recommendation engine.*

### 3.5 Learning Agent
Improves its behavior over time based on feedback.
```
Experience → [Learning] → Improved performance element
```
*Analogy: A recommendation system that improves with ratings.*

**Where does Jazper fit?**
Jazper targets **Goal-Based + Model-Based** — it takes your goal, maintains state about you via memory, plans a sequence of actions, executes them. With feedback loops added later, it becomes Learning.

---

## 4. The System Prompt — Most Underrated Component

The system prompt is where you define the agent's:
- **Identity**: Who it is, what it's for
- **Capabilities**: What it can and can't do
- **Reasoning style**: How it should think (step by step? ask clarifying questions?)
- **Constraints**: What it must never do
- **Output format**: How it should structure responses
- **Tool usage rules**: When to use tools vs. answer directly

**Poor system prompt:**
```
You are a helpful assistant named Jazper. Answer questions helpfully.
```

**Agent-grade system prompt (structured):**
```
## Identity
You are Sir Jazper, a personal AI operating system for Vijay Moirangthem.
You are the orchestrator — you see every request, decide how to handle it,
and either answer directly or delegate to specialist agents.

## Core Principles
- Always ground factual claims in tool results, never hallucinate
- Prefer specific, actionable responses over generic ones
- Vijay values speed and directness — skip pleasantries
- When uncertain, use tools to verify before answering

## Decision Framework
1. Can I answer this accurately from memory? → Answer directly
2. Do I need current/external information? → Use search tool
3. Is this a multi-step task that will take >3 tool calls? → Plan first, then execute
4. Does this require specialized capability? → Delegate to specialist agent

## Constraints
- Never send emails without explicit confirmation
- Never delete data without confirmation
- Always cite sources when using web search results
- Maximum 10 tool calls per request before asking for guidance

## Available Specialists
- ResearchAgent: Deep research, document analysis, summarization
- JobApplyAgent: Job searching, application management, cover letters
- EmailAgent: Gmail reading, drafting, categorization
```

---

## 5. How Jazper's Architecture Looks Today

```
User Message
    │
    ▼
chat.py (route handler)
    │
    ├── asyncio.gather() ──► DB: core_memories, session history,
    │                            user profile, long-term memories
    │
    ▼
Build messages array (context engineering)
    │
    ▼
ai_provider.stream_with_tools()
    │
    ├── [LM Studio / Gemma] ◄── Tools: memory_store, task_create,
    │        │                          search_longterm, etc.
    │        │
    │        └── Tool call? ──► execute_tool() ──► result ──► back to LLM
    │
    ▼
Stream response to frontend
    │
    ├── background: extract_memories(), save_history()
    │
    ▼
User sees response
```

**What's missing for full agency:**
- The LLM only does one tool call per turn (no loop back after tool result to call more tools)
- No planning step before execution
- No sub-agent delegation
- Memory is keyword-searched, not semantically searched

---

## 6. Architecture Patterns at a Glance

| Pattern | Description | When to Use |
|---------|-------------|-------------|
| **Single Agent** | One LLM + tools | Simple tasks, low complexity |
| **Router** | One agent picks which specialist to call | When tasks are clearly categorized |
| **Sequential Chain** | Agent A output → Agent B input | Pipeline-style tasks |
| **Supervisor** | Orchestrator delegates to workers, reviews results | Complex, multi-domain tasks |
| **Hierarchical** | Orchestrator → Sub-orchestrators → Workers | Enterprise-scale systems |
| **Debate** | Multiple agents argue, one synthesizes | High-stakes decisions |

**Jazper's target pattern: Supervisor**
- Jazper = Supervisor/Orchestrator
- ResearchAgent, JobApplyAgent, EmailAgent = Workers
- Jazper reviews sub-agent outputs before responding to you

---

## 7. Key Architecture Decisions You'll Face

### Decision 1: How much autonomy?
*Fully autonomous* (agent acts, you see results) vs *Human-in-the-loop* (agent proposes, you approve).

**Jazper rule**: Autonomous for read-only actions (search, read email, query DB). Human confirmation for write actions (send email, apply to job, delete task).

### Decision 2: Monolithic vs modular agents?
*One agent with many tools* vs *many specialized agents with fewer tools each*.

**Trade-off**: Monolithic is simpler to build but the context gets bloated (all tools visible at once). Modular scales better but adds routing complexity.

**Jazper approach**: Start monolithic, extract specialists as complexity grows.

### Decision 3: How do agents communicate?
- **Direct call**: Orchestrator calls sub-agent like a function
- **Message queue**: Agents post to queues, others consume (async, decoupled)
- **Shared state**: All agents read/write a shared DB (PostgreSQL in Jazper's case)

**Jazper uses**: Direct calls (simple) + Shared state via PostgreSQL (already in place).

---

## Next: [03 — Reasoning Patterns](./03-reasoning-patterns.md)
