# 03 — Reasoning Patterns

## Summary
How an agent thinks determines what it can do. This document covers 11 cognitive architectures — from the simple (Chain of Thought) to the sophisticated (Tree of Thoughts, Self-Reflection). For Jazper, ReAct is the priority implementation target.

---

## 1. Why Reasoning Patterns Matter

An LLM without a reasoning pattern just generates the next token. Reasoning patterns give the agent structure:
- **When to think step-by-step** before answering
- **When to verify** its own outputs
- **When to try multiple paths** instead of committing to one
- **When to decompose** a complex problem into solvable sub-problems

Better reasoning = fewer hallucinations, more reliable tool use, better answers on hard tasks.

---

## 2. The 11 Patterns

### 2.1 Chain of Thought (CoT)
**The idea:** Make the model reason step by step before giving the final answer. Mimics how humans "show their work."

**How it works:**
```
Prompt: "How many r's are in 'strawberry'? Think step by step."

Model output:
"Let me count each letter:
s-t-r-a-w-b-e-r-r-y
Position 3: r ✓
Position 8: r ✓
Position 9: r ✓
Answer: 3"
```

**Without CoT:** Model often says 2 (a well-known failure case).
**With CoT:** Model is forced to count explicitly.

**When to use:** Math, logic, multi-step reasoning, any task where intermediate steps matter.

**In Jazper:** Add "Think step by step" to the system prompt for analytical queries. The `enable_thinking` toggle in Jazper is essentially this — it allows the model to output its reasoning chain before the final answer.

**Interview version:** "CoT improves reliability by externalizing the model's reasoning process, reducing the chance of the model 'skipping steps' that lead to wrong conclusions."

---

### 2.2 ReAct (Reason + Act)
**The idea:** Interleave reasoning and acting. After each action, reason about what to do next. This is the foundation of most practical agents.

**The pattern:**
```
Thought: I need to find Vijay's last job application to write a follow-up.
Action: search_db(query="job applications", filter="status=applied")
Observation: Found 3 applications. Most recent: TechCorp, applied 5 days ago.

Thought: I have the application. Now I need their email contact.
Action: search_web(query="TechCorp hiring manager email software engineer")
Observation: Found LinkedIn profile. Recruiter: Jane Smith, jane@techcorp.com

Thought: I have enough to draft the follow-up email.
Action: draft_email(to="jane@techcorp.com", subject="Following up on SE application", ...)
Observation: Draft created.

Thought: Done. I should present the draft to Vijay for review.
Final Answer: "Here's a follow-up email draft for TechCorp..."
```

**Why it works:**
- The agent doesn't plan everything upfront — it adapts based on what tools return
- Each "Thought" step prevents jumping to conclusions
- The observation feeds back into the next reasoning step

**Structure:**
```
while not done:
    thought = llm.think(context)
    if thought.is_final:
        return thought.answer
    action = thought.chosen_action
    observation = execute(action)
    context.add(thought, action, observation)
```

**Jazper status:** Partially implemented. The tool loop exists but only for one iteration. Full ReAct = allow N iterations per turn. **This is the #1 next upgrade.**

**Interview version:** "ReAct grounds the agent's reasoning in real observations from the environment, preventing the model from reasoning in a vacuum and hallucinating facts it should verify."

---

### 2.3 Self-Ask
**The idea:** Before answering, the model asks itself sub-questions and answers them first.

```
Q: Who is the CEO of the company that acquired DeepMind?
Self-Ask: Who acquired DeepMind?
Answer: Google (Alphabet)
Self-Ask: Who is the CEO of Alphabet?
Answer: Sundar Pichai
Final Answer: Sundar Pichai
```

**When to use:** Multi-hop questions where the answer requires chaining facts.

---

### 2.4 Tree of Thoughts (ToT)
**The idea:** Instead of one reasoning chain, explore multiple branches simultaneously. Evaluate each branch, prune dead ends, continue promising ones.

```
Goal: Write the best cover letter for this job

Branch A: Lead with technical skills
  ├── Version A1: Emphasize Python/FastAPI
  ├── Version A2: Emphasize system design
  └── [Evaluate: A2 scored 8/10 for this job description]

Branch B: Lead with personal story
  ├── Version B1: Origin story approach
  └── [Evaluate: B1 scored 6/10]

Branch C: Lead with specific achievement
  └── [Evaluate: C scored 9/10 — winner]

Final: Expand branch C into full letter
```

**When to use:** Creative tasks, optimization problems, tasks where there are multiple valid approaches and quality matters.

**Computational cost:** Much higher than CoT or ReAct — you're making multiple LLM calls per "thought." Use selectively.

**Jazper application:** Cover letter generation, where you want to try multiple angles and pick the best.

---

### 2.5 Self-Reflection / Self-Critique
**The idea:** After generating an output, the agent critiques its own work and revises.

```
Pass 1 (Generate):
"Here's a cover letter for TechCorp..."

Pass 2 (Critique):
"Critique of my cover letter:
- Too generic, doesn't mention TechCorp's specific product
- Missing a clear call to action
- Paragraph 2 is too long"

Pass 3 (Revise):
"Revised cover letter addressing the critiques..."

Pass 4 (Re-critique):
"Is this better? Yes — specific mention of TechCorp's payment API,
clear call to action, paragraphs balanced."
Final: Return revised version
```

**When to use:** Any output where quality matters — writing, code, plans. Run 1-3 critique-revise cycles.

**Interview version:** "Self-reflection closes the loop between generation and evaluation, allowing the agent to apply the same intelligence that produces output to also improve it — essentially making the model its own editor."

---

### 2.6 Least-to-Most Prompting
**The idea:** Break a hard problem into progressively simpler sub-problems, solve them in order, use earlier solutions to solve later ones.

```
Hard problem: "Plan a 3-month learning path for ML engineering"

Sub-problem 1 (easiest): "What are the prerequisite skills?"
→ Python, statistics, linear algebra

Sub-problem 2: "What are the core ML concepts someone with these prerequisites needs?"
→ Supervised/unsupervised learning, neural networks, optimization

Sub-problem 3: "What's a week-by-week breakdown for learning these?"
→ [Detailed plan built on top of previous answers]

Final: Structured 3-month curriculum
```

**When to use:** Complex planning, curriculum design, anything hierarchically decomposable.

---

### 2.7 Decomposed Prompting (DecomP)
**The idea:** A controller agent breaks the problem into sub-tasks, routes each to a sub-agent specialized for that task type, collects results, and synthesizes.

```
Complex task: "Research this company, evaluate fit for my skills, draft application"

Decomposition:
├── SubTask 1: Research TechCorp → [ResearchAgent]
├── SubTask 2: Evaluate job description vs. Vijay's profile → [AnalysisAgent]
└── SubTask 3: Draft cover letter with findings → [WritingAgent]

Synthesis: Orchestrator combines all outputs into final package
```

**This is the blueprint for Jazper's multi-agent architecture.**

---

### 2.8 Plan-and-Execute
**The idea:** Separate planning from execution completely. First generate a full plan, then execute it step by step.

```
Phase 1 — PLAN:
"Goal: Apply to 5 matching jobs this week
Plan:
1. Search LinkedIn for Python backend roles in [location]
2. Filter by: remote, 3+ years experience, posted < 7 days
3. For each job: check against blacklist, score vs. profile
4. For top 5: generate tailored cover letter
5. Submit applications
6. Add to job tracker DB"

Phase 2 — EXECUTE:
Execute step 1 → [results] →
Execute step 2 → [filtered list] →
Execute step 3 → [scored list] →
...
```

**Advantage over ReAct:** More transparent (you can see the full plan), easier to checkpoint/resume, easier to interrupt and redirect.

**Disadvantage:** Less adaptive — if step 3 fails, the whole plan may be invalid. ReAct adapts in real-time.

**Jazper target:** Plan-and-Execute for long background tasks (job apply runs). ReAct for interactive chat.

---

### 2.9 Reflexion
**The idea:** After a failed attempt, reflect on *why* it failed and store that as memory so the next attempt is better.

```
Attempt 1: Apply to job → FAIL (application form needed specific field format)
Reflection: "The work authorization field required 'Yes/No', not free text. 
             I should detect form field types before filling."
[Store in procedural memory]

Attempt 2: Detect field types first → SUCCESS
```

**Why it's powerful:** The agent learns from failure without retraining the model. The "learning" is stored in memory and injected into future prompts.

---

### 2.10 MCTS (Monte Carlo Tree Search) for Agents
**The idea:** Borrowed from game AI (AlphaGo). Simulate thousands of possible action paths, evaluate outcomes, backpropagate scores, choose the best path.

**When to use:** High-stakes multi-step decisions with known outcome metrics (trading strategies, optimization problems). Computationally expensive. Not for conversational agents.

---

### 2.11 Debate / Multi-Agent Critique
**The idea:** Multiple agents argue different positions. A judge agent evaluates the debate and picks the winner.

```
Task: "Should I accept this job offer?"

Agent A (Pro): "Salary is 40% higher, better tech stack, fully remote..."
Agent B (Con): "Company is only 2 years old, Series A with uncertain runway..."
Judge: Evaluates both arguments, asks clarifying questions, renders decision

Final: "Based on the analysis, here are the key trade-offs..."
```

**When to use:** High-stakes decisions where you want to surface counterarguments. 

---

## 3. Reasoning Pattern Selection Guide

| Situation | Best Pattern |
|-----------|-------------|
| Multi-step math/logic | Chain of Thought |
| Using tools interactively | ReAct |
| Multi-hop fact questions | Self-Ask |
| Creative output quality | Tree of Thoughts |
| Output quality assurance | Self-Reflection |
| Complex planning | Least-to-Most or Plan-and-Execute |
| Multi-domain complex tasks | Decomposed Prompting |
| Learning from failure | Reflexion |
| High-stakes decisions | Debate |
| Long autonomous runs | Plan-and-Execute + Reflexion |

---

## 4. Jazper's Reasoning Stack

For Jazper specifically, the target stack is:

```
Interactive Chat → ReAct (immediate, adaptive)
     + Self-Reflection (for writing/code quality tasks)
     
Background Tasks → Plan-and-Execute (transparent, resumable)
     + Reflexion (learn from job apply failures)
     
Multi-agent calls → Decomposed Prompting
     (Jazper decomposes → routes → synthesizes)
     
Cover letters, reports → Tree of Thoughts (best quality output)
```

---

## 5. Implementing ReAct in Jazper (Next Step)

Current Jazper chat flow:
```
User → [1 LLM call] → [0 or 1 tool call] → Response
```

ReAct Jazper flow:
```
User → [LLM call #1] → [Tool call A] → [Observation A]
     → [LLM call #2] → [Tool call B] → [Observation B]
     → [LLM call #3] → [Final answer] → Response
```

The change in `chat.py`:
```python
# Current (single pass)
async for event in ai_provider.stream_with_tools(messages, tools):
    # handle events

# ReAct (loop)
max_steps = 10
for step in range(max_steps):
    response = await ai_provider.call_with_tools(messages, tools)
    
    if response.stop_reason == "end_turn":
        # Stream final answer to user
        yield response.content
        break
    
    # Execute tool(s)
    for tool_call in response.tool_calls:
        result = await execute_tool(tool_call)
        messages.append(tool_result_message(tool_call, result))
    
    # Loop: LLM will now reason about the tool result
```

---

## Next: [04 — Memory Systems](./04-memory-systems.md)
