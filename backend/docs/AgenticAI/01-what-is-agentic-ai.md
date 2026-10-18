# 01 — What Is Agentic AI?

## Summary
An AI agent is a system that perceives its environment, reasons about a goal, takes actions (via tools), and loops until the goal is achieved — without needing a human to guide every step.

---

## 1. The Core Distinction

Most people's experience with AI is a **chatbot**: you send a message, it replies, done. That's a single-turn reactive system.

An **agent** is fundamentally different:

| Dimension | Chatbot | Agent |
|-----------|---------|-------|
| **Input** | One message | A goal |
| **Processing** | One LLM call | Multiple LLM + tool calls in a loop |
| **Output** | One response | A completed objective |
| **Control flow** | You drive each step | Agent drives its own steps |
| **Memory** | Within one context window | Persists across sessions |
| **Initiative** | Reactive only | Can act proactively |

**Simple example:**

> You tell a chatbot: "Research OpenAI's latest funding round and write me a summary."
> It replies: "I don't have internet access, but here's what I know..."
>
> You tell an agent the same thing.
> It: searches the web → reads 3 articles → extracts key facts → checks your stored preferences → writes in your preferred tone → returns a polished summary.
> All in one turn. You never had to guide it.

---

## 2. The Three Pillars of Agency

Every agent system, no matter how complex, rests on three things:

### Pillar 1: Perception
The agent receives information from the world. This includes:
- Your message (natural language goal)
- Results from tool calls (search results, DB rows, API responses)
- Memory (what it knows about you, the context, past actions)
- State (where is it in the current plan?)

### Pillar 2: Reasoning
The agent thinks about what to do next. This is where the LLM lives. It:
- Interprets the goal
- Decides what information it needs
- Plans which tools to call
- Evaluates whether its current result is good enough
- Decides when it's done

### Pillar 3: Action
The agent does something in the world:
- Calls a tool (search, write to DB, send email)
- Calls a sub-agent (delegates a sub-task)
- Returns a final answer
- Updates its memory

**The loop:** Perception → Reasoning → Action → Perception → Reasoning → Action → ... → Done

---

## 3. What Makes an LLM "Agentified"

An LLM by itself is not an agent. It's a function: `text_in → text_out`. To make it agentic you add:

1. **A system prompt** that gives it a persona, goal, and instructions about how to behave
2. **Tools** — functions the LLM can call (web search, calculator, API, DB query)
3. **A loop** — code that runs the LLM, executes whatever tool it chose, feeds the result back, and repeats
4. **Memory** — storage the agent can read/write across turns and sessions
5. **A stopping condition** — how the agent knows it's done (produces a final answer with no more tool calls)

That's it. The sophistication of an agent comes from how well these five things are designed, not from magic.

---

## 4. Levels of Agency

There's a spectrum, not a binary:

**Level 0 — Chatbot**
Single LLM call. No tools. No memory beyond the conversation window.
*Example: Raw ChatGPT with no plugins.*

**Level 1 — Tool-Augmented**
LLM can call tools. Still single-turn — you ask, it calls tools if needed, responds.
*Example: Jazper today.*

**Level 2 — ReAct Agent**
LLM loops: Reason → Act → Observe → Reason → Act → ... → Answer.
Can chain multiple tools across multiple reasoning steps.
*Example: Jazper's next upgrade.*

**Level 3 — Planning Agent**
Before acting, the LLM generates a full plan (list of steps), then executes it step by step. Can re-plan if steps fail.
*Example: Jazper Phase 3.*

**Level 4 — Multi-Agent System**
Multiple specialized agents. An orchestrator decomposes goals and routes to specialists. Specialists report back. Results synthesized.
*Example: Jazper Phase 2-3 combined.*

**Level 5 — Autonomous Agent**
Runs continuously without human input. Monitors the environment, self-initiates tasks, maintains long-horizon goals over days/weeks.
*Example: Jazper's background cron agents, fully agentic.*

---

## 5. The "Agentic Loop" in Plain Code

Here's the conceptual loop that drives every agent:

```python
def run_agent(goal: str, tools: list, memory: Memory) -> str:
    context = memory.recall_relevant(goal)
    messages = [system_prompt, context, {"role": "user", "content": goal}]
    
    while True:
        response = llm.call(messages, tools=tools)
        
        if response.is_final_answer:
            memory.store(goal, response.content)
            return response.content
        
        # Agent chose to call a tool
        tool_result = execute_tool(response.tool_call)
        
        # Feed result back into context
        messages.append(response)           # agent's reasoning + tool choice
        messages.append(tool_result)        # what the tool returned
        
        # Loop — agent now reasons again with the new information
```

This is what we're building in Jazper. The `while True` loop is the key. Today Jazper does one iteration. A true agent does N.

---

## 6. Why Agency Matters for Jazper Specifically

Jazper is a personal AI OS. "Personal" means it should:
- Know your preferences deeply (memory)
- Handle multi-step tasks end-to-end (tool loop)
- Monitor things for you proactively (background agents)
- Coordinate specialized capabilities (multi-agent)

A chatbot Jazper says: "Here's how to apply for that job."
An agentic Jazper says: "Done — I found 3 matching positions, tailored your resume for each, drafted cover letters in your voice, and added follow-up reminders to your task list."

---

## 7. Key Vocabulary (Interview Essential)

| Term | Definition |
|------|-----------|
| **Agent** | LLM + tools + loop + memory, working toward a goal |
| **Orchestrator** | The top-level agent that plans and delegates |
| **Sub-agent / Specialist** | A focused agent with a narrow system prompt |
| **Tool** | A function the agent can call (search, API, DB) |
| **Tool loop** | The Reason → Act → Observe cycle |
| **ReAct** | Reason + Act interleaved (a specific loop pattern) |
| **System prompt** | The instructions that shape an agent's persona and behavior |
| **Context window** | The LLM's working memory — limited tokens |
| **Grounding** | Connecting the LLM to real, up-to-date information via tools |
| **Hallucination** | When an LLM makes up facts — agents reduce this via grounding |
| **Autonomy** | Degree to which an agent acts without human input |
| **Human-in-the-loop** | Design pattern where humans confirm risky agent actions |

---

## 8. Common Misconceptions

**"Agentic AI = more powerful model"**
No. A GPT-4 chatbot is less useful than a well-architected GPT-3.5 agent. The architecture matters more than the model size for most real tasks.

**"You need multiple different models"**
No. One model with different system prompts can power multiple specialist agents. That's exactly what Jazper will do — one Gemma instance, different injected personas.

**"Agents are fully autonomous and can't be controlled"**
No. You design the level of autonomy. You add human-in-the-loop checkpoints for risky actions (sending emails, deleting files). Autonomy is a dial you set.

**"Agents always work correctly"**
No. Agents fail, get stuck in loops, misinterpret goals. Good agent design includes failure modes, retries, and escalation paths.

---

## Next: [02 — Agent Architecture](./02-agent-architecture.md)
