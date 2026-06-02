# 05 — Tools & Tool Loops

## Summary
Tools are what agents use to interact with the world beyond text. A tool is any function the LLM can invoke. The tool loop is the mechanism that lets the agent call tools repeatedly until it's done. This is the engine of agentic behavior.

---

## 1. What Is a Tool?

A tool is a **function + a description the LLM can read**.

The LLM never actually calls the function. It outputs a structured specification:
```json
{"tool": "search_web", "arguments": {"query": "OpenAI funding round 2026"}}
```

Your code reads this, executes the real function, and returns the result back to the LLM.

```
LLM → "I want to call search_web with query X"
Your code → calls actual search API
Your code → returns results to LLM
LLM → reasons about results → next action
```

**Why this design?** LLMs can't directly run code or call APIs. They can only generate text. The "tool call" is just structured text that your surrounding code interprets as an instruction.

---

## 2. Anatomy of a Tool Definition

Every tool needs three things:

```python
{
    "name": "search_web",
    
    "description": """Search the internet for current information.
    Use this when you need facts that may have changed since your training,
    or when the user asks about recent events, specific companies, or live data.
    Do NOT use this for information already in your memory.""",
    
    "input_schema": {
        "type": "object",
        "properties": {
            "query": {
                "type": "string",
                "description": "The search query. Be specific. Use quotes for exact phrases."
            },
            "max_results": {
                "type": "integer",
                "description": "How many results to return. Default 5, max 20.",
                "default": 5
            }
        },
        "required": ["query"]
    }
}
```

**The description is everything.** The LLM decides when to call a tool based entirely on reading this description. A bad description = tool gets called at wrong times or never.

**Good description checklist:**
- ✅ Explains what the tool does
- ✅ Explains when to use it (triggers)
- ✅ Explains when NOT to use it (prevents overuse)
- ✅ Gives format hints for parameters
- ❌ Don't just describe the function name

---

## 3. Categories of Tools

### 3.1 Read Tools (Safe, no side effects)
Information retrieval — safe to call any time.

| Tool | What it does |
|------|-------------|
| `search_web` | Web search via Brave/Google API |
| `read_memory` | Query long-term memories |
| `search_jobs` | Search LinkedIn/Indeed |
| `read_email` | Read Gmail messages |
| `get_tasks` | List current tasks |
| `get_calendar` | Check schedule |
| `query_db` | Custom SQL query on your data |

### 3.2 Write Tools (Require care)
Modify state — should be used thoughtfully.

| Tool | What it does |
|------|-------------|
| `store_memory` | Add to long-term memory |
| `create_task` | Add a task |
| `update_task` | Mark task complete, etc. |
| `write_file` | Create/edit a file |
| `send_notification` | Send in-app notification |

### 3.3 Action Tools (High impact — consider confirmation)
Real-world consequences.

| Tool | What it does |
|------|-------------|
| `send_email` | Actually sends an email |
| `submit_job_application` | Submits an application |
| `post_to_linkedin` | Posts content publicly |
| `delete_record` | Permanent deletion |

**Best practice:** For action tools, add a `confirm: bool` parameter. The LLM sets it to `False` by default (draft mode). You explicitly confirm before execution.

### 3.4 Compute Tools
Processing operations.

| Tool | What it does |
|------|-------------|
| `run_python` | Execute Python code (sandboxed) |
| `analyze_document` | Parse a PDF/document |
| `generate_embedding` | Embed text for vector search |
| `calculate` | Math/formula evaluation |

### 3.5 Sub-Agent Tools
Delegate to specialist agents.

| Tool | What it does |
|------|-------------|
| `research_agent` | Deep research on a topic |
| `job_apply_agent` | Run the full job apply workflow |
| `email_agent` | Handle email tasks |
| `writing_agent` | Generate long-form content |

---

## 4. The Tool Loop in Detail

This is the core mechanism that makes agents work:

```
┌─────────────────────────────────────────────────────────────┐
│                     TOOL LOOP                               │
│                                                             │
│  [Build Context]                                            │
│       │                                                     │
│       ▼                                                     │
│  [LLM Call] ─── stop_reason: end_turn ──► [Return Answer]  │
│       │                                                     │
│       │ stop_reason: tool_use                               │
│       ▼                                                     │
│  [Parse Tool Call]                                          │
│       │                                                     │
│       ▼                                                     │
│  [Execute Tool] ──── Error? ──► [Error handling / retry]   │
│       │                                                     │
│       ▼                                                     │
│  [Append Result to Messages]                                │
│       │                                                     │
│       └──────────────────────────────► [LLM Call] (loop)   │
│                                                             │
│  [Max steps reached] ──► [Force final answer]              │
└─────────────────────────────────────────────────────────────┘
```

**Full implementation for Jazper's chat.py:**

```python
async def run_react_loop(
    messages: list,
    tools: list,
    ai_provider,
    max_steps: int = 10
) -> AsyncGenerator[str, None]:
    
    step = 0
    
    while step < max_steps:
        step += 1
        
        # Call LLM (non-streaming for intermediate steps, streaming for final)
        response = await ai_provider.call(messages, tools=tools)
        
        # Check if we're done
        if response.stop_reason == "end_turn":
            # Stream the final answer
            async for chunk in ai_provider.stream(response.content):
                yield chunk
            return
        
        # Handle tool calls
        if response.stop_reason == "tool_use":
            # Add assistant's message (with tool call) to history
            messages.append({
                "role": "assistant",
                "content": response.content  # includes tool_use blocks
            })
            
            # Execute all tool calls (possibly parallel)
            tool_results = []
            for tool_use in response.tool_calls:
                try:
                    result = await execute_tool(tool_use.name, tool_use.input)
                    tool_results.append({
                        "type": "tool_result",
                        "tool_use_id": tool_use.id,
                        "content": str(result)
                    })
                except Exception as e:
                    tool_results.append({
                        "type": "tool_result",
                        "tool_use_id": tool_use.id,
                        "content": f"Error: {str(e)}",
                        "is_error": True
                    })
            
            # Add tool results to history
            messages.append({
                "role": "user",
                "content": tool_results
            })
            
            # Loop — LLM will now reason about the results
            continue
    
    # Max steps reached — force a final answer
    messages.append({"role": "user", "content": 
        "You've reached your step limit. Please summarize what you found and provide your best answer."
    })
    async for chunk in ai_provider.stream_final(messages):
        yield chunk
```

---

## 5. Parallel Tool Execution

When the LLM requests multiple tools in one step, execute them in parallel:

```python
# Sequential (slow)
for tool_call in tool_calls:
    results.append(await execute_tool(tool_call))

# Parallel (fast)
results = await asyncio.gather(*[
    execute_tool(tc) for tc in tool_calls
])
```

**Real example:** LLM decides it needs web search + DB query + memory read simultaneously. Sequential = 3 × latency. Parallel = 1 × max(latency). Always parallelize independent tool calls.

---

## 6. Tool Design Principles

### Principle 1: Single Responsibility
Each tool does exactly one thing. Don't make a `do_everything` tool.

❌ Bad:
```python
def manage_jobs(action, params):
    if action == "search": ...
    elif action == "apply": ...
    elif action == "track": ...
```

✅ Good:
```python
def search_jobs(query, filters): ...
def apply_to_job(job_id, cover_letter): ...
def track_application(job_id, status): ...
```

### Principle 2: Idempotent where possible
Calling a read tool twice should return the same result. This matters for error handling — safe to retry.

### Principle 3: Return structured, not human text
Tools should return data the LLM can reason about, not pre-written prose.

❌ Bad: `"There are 3 pending tasks: Buy milk, Fix bug #123, Call dentist"`

✅ Good:
```json
[
  {"id": "1", "title": "Buy milk", "priority": "low", "due": null},
  {"id": "2", "title": "Fix bug #123", "priority": "high", "due": "2026-05-25"},
  {"id": "3", "title": "Call dentist", "priority": "medium", "due": "2026-05-24"}
]
```

The LLM can then select, filter, and reason about this data. Pre-written prose removes that flexibility.

### Principle 4: Include metadata in results
```json
{
  "results": [...],
  "total_count": 47,
  "query": "Python jobs remote Singapore",
  "retrieved_at": "2026-05-24T10:30:00Z",
  "sources": ["linkedin.com", "indeed.com"]
}
```

### Principle 5: Fail gracefully with informative errors
```python
try:
    result = call_api(params)
    return {"status": "success", "data": result}
except RateLimitError:
    return {"status": "error", "error": "rate_limited", 
            "message": "API rate limit hit. Try again in 60 seconds."}
except NetworkError:
    return {"status": "error", "error": "network", 
            "message": "Could not reach the API. Check internet connection."}
```

---

## 7. Tool Safety

### Human-in-the-loop for destructive actions

```python
async def execute_tool(tool_name, tool_input):
    tool = TOOL_REGISTRY[tool_name]
    
    if tool.requires_confirmation:
        # Don't execute — return a confirmation request
        return {
            "requires_confirmation": True,
            "action": tool_name,
            "details": f"I want to: {tool.describe_action(tool_input)}",
            "confirm_endpoint": "/api/confirm"
        }
    
    return await tool.execute(tool_input)
```

The LLM sees this result, tells the user "I need your confirmation to send this email", and waits.

### Tool permissions

```python
TOOL_PERMISSIONS = {
    "search_web":     "read",    # always allowed
    "read_memory":    "read",    # always allowed
    "store_memory":   "write",   # allowed by default
    "create_task":    "write",   # allowed by default
    "send_email":     "action",  # requires confirmation
    "submit_apply":   "action",  # requires confirmation
    "delete_data":    "danger",  # requires explicit password/pin
}
```

### Rate limiting and cost tracking

```python
TOOL_CALL_LOG: dict = defaultdict(list)

async def execute_tool_with_limits(tool_name, input, session_id):
    calls_this_minute = [t for t in TOOL_CALL_LOG[session_id] 
                         if time.time() - t < 60]
    if len(calls_this_minute) > 20:
        raise RateLimitError("Too many tool calls this minute")
    
    TOOL_CALL_LOG[session_id].append(time.time())
    return await execute_tool(tool_name, input)
```

---

## 8. Jazper's Current Tool Set

```python
# In chat.py — currently registered tools
tools = [
    {
        "name": "memory_store",
        "description": "Store important information about Vijay to long-term memory...",
    },
    {
        "name": "search_longterm_memory",
        "description": "Search through past memories and facts about Vijay...",
    },
    {
        "name": "task_create",
        "description": "Create a new task for Vijay...",
    },
    # ... more tools
]
```

**What to add next:**
1. `web_search` — Connect to Brave Search API or SerpAPI (free tier available)
2. `read_email_summary` — Read recent Gmail (already have OAuth in place)
3. `search_jobs_live` — Pull from LinkedIn/Indeed API
4. `analyze_document` — Parse a PDF (for resume analysis, job descriptions)
5. `research_agent` — The sub-agent delegation tool

---

## 9. Tool Observability

In production, you want to log every tool call:

```python
async def execute_tool_with_logging(tool_name, input, session_id):
    start = time.time()
    
    log.info("tool_call_start", 
             tool=tool_name, session=session_id, input=input)
    
    try:
        result = await execute_tool(tool_name, input)
        duration = time.time() - start
        
        log.info("tool_call_success",
                 tool=tool_name, duration_ms=int(duration*1000),
                 result_size=len(str(result)))
        
        return result
    
    except Exception as e:
        log.error("tool_call_failed",
                  tool=tool_name, error=str(e), duration_ms=int((time.time()-start)*1000))
        raise
```

This feeds into your Logs panel — you can see exactly what tools Jazper called and when.

---

## 10. Tool Loop vs. Function Calling: Terminology

These terms get used interchangeably but have specific meanings:

| Term | Meaning |
|------|---------|
| **Function calling** | The LLM API feature that outputs structured tool invocations |
| **Tool use** | Anthropic's Claude-specific term for the same feature |
| **Tool loop** | The surrounding code that runs tools and loops back |
| **ReAct** | A specific pattern for interleaving reasoning and tool use |
| **Agentic loop** | General term for the whole Perception→Reason→Act→Observe cycle |

---

## Next: [06 — Multi-Agent Systems](./06-multi-agent-systems.md)
