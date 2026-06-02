# 08 — Interview Prep: Agentic AI

## How to use this
These are real questions asked in interviews for roles involving agentic AI, LLM engineering, and AI product development. Each has a concise answer you can deliver verbally plus notes on what makes a strong answer.

---

## Section 1: Fundamentals

**Q1: What is an AI agent? How is it different from a chatbot?**

A chatbot is a single-turn reactive system — you send one message, it responds once. An AI agent is a goal-driven system that perceives its environment, reasons, takes actions via tools, observes results, and loops until the goal is achieved — all without a human guiding each step.

The key differences: agents have persistent memory across sessions, they can call external tools and APIs, they operate in multi-step loops rather than single turns, and they can initiate work proactively rather than just responding.

*Strong answer adds:* "Practically, this means an agent can handle a task like 'research this company and draft an application' as a single instruction, whereas a chatbot would need you to guide every step manually."

---

**Q2: What are the main components of an AI agent?**

Five components:
1. **LLM Brain** — the reasoning and decision-making engine
2. **Memory** — storage for facts, episodes, knowledge, and learned preferences
3. **Tools** — functions the agent can call to interact with the world (search, APIs, DBs)
4. **Orchestration logic** — the code that runs the Reason→Act→Observe loop and manages state
5. **Environment** — everything outside the agent: the web, databases, APIs, other agents

*Strong answer adds:* "The LLM itself is stateless — it has no memory between calls. All continuity comes from what the surrounding architecture injects into the context window. That's why architecture matters more than raw model capability."

---

**Q3: What is RAG? How does it relate to agent memory?**

RAG (Retrieval Augmented Generation) is the pattern of retrieving relevant documents from an external store and injecting them into the LLM's context before generating a response. It grounds the model in real, specific, up-to-date information.

Agent memory IS a personalized RAG system. Instead of a document corpus, you retrieve memories — facts about the user, past interactions, learned preferences — and inject them into the agent's context for each request.

The difference from classic RAG: agent memory is dynamic (updated by the agent's own actions), personalized (specific to one user), and multi-typed (episodic, semantic, procedural) rather than a flat document store.

---

**Q4: What is a vector embedding? Why are they used in agent memory?**

A vector embedding is a high-dimensional numerical representation of text (or any data) where semantic similarity is preserved as geometric proximity. Text with similar meaning ends up close in vector space; unrelated text is far apart.

They're used in agent memory because semantic search is far superior to keyword matching. "I prefer remote work" and "I like working from home" have different words but similar meaning — a vector search finds them as related; a keyword search misses the connection entirely.

*Strong answer adds:* "You generate embeddings with a separate embedding model, store them in a vector database (like pgvector in PostgreSQL), and query with approximate nearest-neighbor search — cosine similarity in practice."

---

**Q5: What is the context window and why does it matter for agents?**

The context window is the total number of tokens (roughly, word fragments) the LLM can process in a single call. It's the model's "working memory" — everything it can "see" at once.

For agents, this is the core constraint. You want to inject: system prompt, user profile, relevant memories, conversation history, tool results, and the current message. If all of this exceeds the window, something gets cut. Managing what to include and what to exclude — called context engineering — directly determines agent quality.

*Strong answer adds:* "Long context windows (128K+) reduce this pressure but don't eliminate it. At scale, every extra token costs compute. Smart retrieval that injects only the most relevant content is always better than brute-force injection."

---

## Section 2: Reasoning and Patterns

**Q6: What is ReAct and why is it the foundation of most agents?**

ReAct (Reason + Act) is a cognitive pattern where the agent interleaves thinking and acting. The sequence is:
- **Thought**: "I need to know X to answer this"
- **Action**: calls a tool to get X
- **Observation**: receives the tool result
- **Thought**: "Given X, I now need Y..."
- [loop until done]

It's foundational because it grounds the agent's reasoning in real observations rather than letting it reason in a vacuum. Each thought is informed by actual tool results, dramatically reducing hallucination and enabling multi-step tasks.

---

**Q7: What is Chain of Thought prompting? When does it help?**

Chain of Thought (CoT) instructs the model to reason step-by-step before giving a final answer. Instead of jumping to a conclusion, it "shows its work."

It helps most on tasks where intermediate reasoning matters: math problems, multi-hop logic, code debugging, planning. It works because modern LLMs are trained to produce coherent next-token predictions — a step-by-step reasoning chain makes each step's "next token" more predictable and correct.

---

**Q8: What is Tree of Thoughts? When would you use it over ReAct?**

Tree of Thoughts explores multiple reasoning paths simultaneously, evaluates each, prunes dead ends, and continues promising branches — like a search tree over possible approaches.

Use it when: there are multiple valid approaches and quality is the priority (creative writing, optimization, architecture decisions). Avoid it for: time-sensitive tasks, or tasks where one clear path exists — it's computationally expensive (many LLM calls).

Use ReAct when the agent needs to adapt in real-time based on tool results. Use ToT when you want to find the *best* answer among multiple approaches before committing.

---

**Q9: What is Reflexion?**

Reflexion is a learning pattern where, after a task failure, the agent reflects on what went wrong and stores the lesson as memory. On the next attempt, it retrieves that lesson and avoids the same mistake.

It allows agents to improve over time without retraining the underlying model. The "learning" is stored in memory and injected into future prompts. It's essentially applying the agent's own reasoning capabilities to improve its behavior — the agent as its own critic and teacher.

---

## Section 3: Memory Systems

**Q10: What are the 6 types of agent memory?**

1. **Working memory** — the context window; ephemeral, fast, expensive per token
2. **Episodic memory** — records of past events and actions ("what happened")
3. **Semantic memory** — factual knowledge stored as embeddings, retrieved by meaning
4. **Procedural memory** — learned workflows and preferences ("how to do things")
5. **Declarative memory** — explicit facts about the user (name, skills, goals)
6. **Cache memory** — recent LLM responses, semantic deduplication to avoid redundant calls

*Strong answer adds:* "In practice, you implement these as different database tables with different retrieval strategies. Semantic and episodic use vector search; declarative uses structured queries; procedural is injected directly into the system prompt."

---

**Q11: How does semantic search work in a vector database?**

1. An embedding model converts your query text into a vector (list of numbers)
2. The database finds stored vectors that are geometrically closest to the query vector — using cosine similarity or L2 distance
3. Returns the k most similar items

In PostgreSQL with pgvector:
```sql
SELECT content FROM memories
ORDER BY embedding <=> query_embedding::vector
LIMIT 5;
```
The `<=>` operator is cosine distance. Results closest to 0 are most similar.

---

**Q12: What is hybrid search?**

Combining keyword (BM25/LIKE) search with vector (semantic) search, then merging results. Keyword search catches exact term matches that might score low in vector space; semantic search catches conceptual matches that might not share exact words. Reciprocal Rank Fusion (RRF) merges the ranked lists.

Best for: production RAG and memory systems where you want both precision (keywords) and recall (semantics).

---

## Section 4: Multi-Agent Systems

**Q13: What is the orchestrator/supervisor pattern in multi-agent systems?**

One central agent (the orchestrator) receives the user's goal, breaks it down into sub-tasks, routes each sub-task to a specialized sub-agent, collects their results, and synthesizes a final response. Sub-agents are focused on narrow domains (research, email, writing) and don't communicate with each other directly — all coordination goes through the orchestrator.

The advantage: clear hierarchy, easy to debug, each specialist can be optimized independently, failures are contained.

---

**Q14: Do multi-agent systems require multiple AI models?**

No. The same LLM instance can power multiple specialist agents simultaneously — you just inject different system prompts per agent. The model doesn't change; the context does.

You'd use multiple models when: different tasks have very different capability requirements (e.g., a reasoning model for planning + a fast model for quick lookups), or when you want cost optimization (cheap model for simple tasks, expensive model for complex reasoning).

---

**Q15: How do agents communicate in a multi-agent system?**

Three main patterns:
1. **Direct call** — Orchestrator calls sub-agent like a function, waits for result. Simple, synchronous, easy to debug.
2. **Message queue** — Agents post tasks to a queue, others consume. Async, decoupled, better for long-running tasks.
3. **Shared state** — All agents read/write a shared database. Any agent can pick up where another left off, good for resumable workflows.

In practice, most systems combine all three: direct calls for interactive tasks, message queues for background work, shared DB for state persistence.

---

**Q16: What is agent swarm vs. supervisor architecture?**

**Supervisor/Orchestrator**: One coordinator, multiple specialists. Clear hierarchy, one agent makes all routing decisions. Good for complex, multi-domain tasks.

**Swarm**: Multiple identical agents working on different instances of the same task simultaneously. No hierarchy — agents collaborate peer-to-peer or work independently on partitioned work. Good for parallelizing homogeneous workloads (e.g., 10 agents each researching a different company).

---

## Section 5: Design and Trade-offs

**Q17: What is human-in-the-loop and when should agents use it?**

Human-in-the-loop (HITL) means the agent pauses and requests human confirmation before taking a consequential action — sending an email, submitting an application, deleting data.

Use HITL for: irreversible actions, actions visible to third parties, anything with financial or legal implications, anything where a mistake is costly.

Skip HITL for: read operations, internal state changes, low-stakes writes (creating a task, storing a note).

The principle: automate the routine, escalate the consequential.

---

**Q18: How do you prevent an agent from getting stuck in a loop?**

Four safeguards:
1. **Max step limit** — hard cap on tool calls per turn (e.g., 10 steps)
2. **Repetition detection** — if the same tool is called with the same args twice, break the loop
3. **Progress checking** — after N steps, ask the LLM if it's making progress; if not, summarize and return
4. **Timeout** — wall-clock timeout per agent run

Always handle max-step exhaustion gracefully: "I've reached my step limit. Here's what I found so far..." rather than crashing.

---

**Q19: What's the difference between a tool and a sub-agent?**

A **tool** is a deterministic function — given the same inputs, it produces the same outputs. It does one specific thing (search the web, query a database). No reasoning, no LLM call.

A **sub-agent** is an LLM-powered system with its own reasoning, tools, and potentially its own memory. It can handle open-ended instructions: "research this company" could result in many different actions depending on what it finds. The output isn't deterministic — it's intelligent.

Rule of thumb: if a function call suffices, use a tool. If you need reasoning and adaptability, use a sub-agent.

---

**Q20: How do you evaluate an agent system?**

Multi-dimensional evaluation:
- **Task completion rate** — % of tasks completed successfully
- **Tool call efficiency** — avg steps per task (fewer = better reasoning)
- **Factual accuracy** — are tool-grounded answers correct? (compare to ground truth)
- **Latency** — end-to-end time per task
- **Cost** — tokens consumed per task (LLM calls + tool calls)
- **User satisfaction** — feedback, edits, explicit ratings
- **Failure modes** — classification of failure types for debugging

For production: track all of these per agent, per task type. Use Reflexion to close the loop on failures.

---

## Section 6: Practical and Architectural

**Q21: What frameworks exist for building agents?**

| Framework | Best for |
|-----------|---------|
| **LangChain** | General-purpose, large ecosystem, good for RAG |
| **LangGraph** | Complex multi-agent workflows as state machines |
| **AutoGen** (Microsoft) | Conversational multi-agent systems |
| **CrewAI** | Role-based multi-agent teams |
| **OpenAI Agents SDK** | Claude/OpenAI-native agent building |
| **Custom** | Full control, no framework overhead |

*Strong answer adds:* "I prefer starting custom for greenfield projects — frameworks add abstraction overhead and can be hard to debug when they go wrong. Once patterns are established, a framework can speed up development."

---

**Q22: What is LangGraph and how does it differ from LangChain?**

LangChain is a general-purpose framework for building LLM applications — chains, RAG pipelines, agent loops. It's flexible but can be hard to manage complex flows.

LangGraph is built on top of LangChain specifically for multi-agent workflows modeled as stateful graphs. Each node is an agent or processing step; edges define control flow; state is passed and accumulated through the graph.

LangGraph is better for: complex multi-agent systems, workflows that need to branch/loop, systems that need to checkpoint and resume. LangChain is better for: simpler chains, standard RAG, well-established patterns.

---

**Q23: How would you architect memory for a personal AI assistant?**

Four-layer approach:
1. **Declarative (PostgreSQL table)**: User profile — name, skills, goals, static facts. Always injected.
2. **Semantic (pgvector)**: Everything ever said — embedded and stored. Retrieved by cosine similarity to current query.
3. **Episodic (PostgreSQL + embeddings)**: Session summaries and significant events. Retrieved by time + semantic search.
4. **Procedural (PostgreSQL)**: Learned preferences and rules. Always injected into system prompt.

Retrieval strategy: for each request, semantic search across layers 2-3, combine with always-injected layers 1+4, trim to token budget. This gives the agent maximum relevant context at minimal token cost.

---

**Q24: What is context engineering?**

Context engineering is the discipline of deciding what information to include in an LLM's context window for a given request. It's not about the model — it's about the inputs you give it.

Good context engineering:
- Includes relevant memories but not all memories
- Prioritizes recent + similar context
- Injects structured data over prose where possible
- Keeps system prompt tight and focused
- Trims gracefully when approaching token limits
- Puts most important information at start and end (primacy/recency effects)

It's often the highest-leverage improvement you can make to an agent system — better than a larger model.

---

**Q25: How do you handle agent failures in production?**

Layered approach:
1. **Retry with exponential backoff** for transient failures (network, rate limits)
2. **Tool fallback** — if tool A fails, try tool B for the same capability
3. **Graceful degradation** — if the agent can't complete, return partial results with explanation
4. **Reflexion** — store the failure as a lesson, improve future runs
5. **Human escalation** — for critical tasks, escalate to human notification rather than silent failure
6. **Alerting** — notify via in-app notifications + logs for all agent failures

---

## Section 7: About Your Project (Jazper-specific)

**Q26: Tell me about an agentic AI project you've built.**

*Template answer based on Jazper:*

"I built Sir Jazper OS — a personal AI operating system designed to be a fully agentic assistant. It's built on FastAPI, Next.js, PostgreSQL, and runs a local Gemma LLM via LM Studio for privacy.

The current architecture has tool-augmented chat with streaming, a multi-tier memory system (declarative facts, extracted memories, full session history), an APScheduler-based job execution layer for background tasks, and a custom multi-panel frontend.

The agentic roadmap I'm implementing is:
1. ReAct loop — multi-step tool execution per turn instead of one
2. Semantic memory — pgvector embeddings replacing keyword search for memory retrieval
3. Specialist sub-agents — ResearchAgent, JobApplyAgent, EmailAgent with focused system prompts
4. Goal planner — for complex multi-step tasks, generate an explicit plan before executing

The most interesting design decision was treating sub-agents as tools the orchestrator can call — this keeps the architecture simple while enabling parallel specialist execution."

---

**Q27: What's the hardest problem in building personal AI agents?**

Memory relevance. The agent needs to feel like it knows you deeply, but injecting everything you've ever said would overflow any context window and add noise.

The solution is semantic retrieval — embedding all memories and retrieving by cosine similarity to the current query. But this introduces new problems: embedding model quality, similarity thresholds, handling contradictory memories, and memory staleness (outdated facts scoring highly because the embedding is similar to the query).

Real solution: tiered memory (always-inject declarative, similarity-inject semantic), update-in-place for contradicted facts, and time-decay scoring (more recent memories score higher at equal similarity).

---

## Quick-fire Definitions (For Speed Rounds)

| Term | One-line definition |
|------|---------------------|
| **Hallucination** | LLM generating plausible-sounding but false information |
| **Grounding** | Connecting LLM output to real data via retrieval or tools |
| **Tokenization** | Breaking text into sub-word units for LLM processing |
| **Temperature** | Controls randomness of LLM output (0=deterministic, 1=creative) |
| **Top-p sampling** | Alternative to temperature: samples from top probability mass |
| **System prompt** | Instructions injected before the conversation to shape agent behavior |
| **Fine-tuning** | Further training a pretrained model on specific data/tasks |
| **RLHF** | Reinforcement Learning from Human Feedback — how models learn preferences |
| **Few-shot prompting** | Providing examples in the prompt to guide model behavior |
| **Function calling** | LLM API feature that outputs structured tool invocation specs |
| **Semantic chunking** | Splitting documents by meaning rather than fixed length |
| **Reranking** | Post-retrieval scoring to reorder results by relevance |
| **Agent topology** | The graph structure of how multiple agents connect |
| **Latency vs. quality** | Core trade-off: more LLM calls = better reasoning, more time |
| **Token budget** | Allocated context window space for a component |
| **Prompt injection** | Malicious content in tool results that hijacks agent behavior |

---

## Final Advice

**For interviews:**
- Always connect concepts to concrete examples. "Vector search means the query 'remote work preference' can find memories phrased as 'prefer working from home' even though the words are different."
- Acknowledge trade-offs. Strong candidates don't just describe what something does — they know when NOT to use it.
- Show you've built things. Theoretical knowledge is table stakes; hands-on experience building Jazper sets you apart.
- When asked about a framework you don't know: "I haven't used X specifically, but I understand the pattern it's implementing — it's essentially [Y], which I've built custom in Jazper."

**For depth:**
- Read: "ReAct: Synergizing Reasoning and Acting in Language Models" (paper)
- Read: "Reflexion: Language Agents with Verbal Reinforcement Learning" (paper)
- Read: "Tree of Thoughts: Deliberate Problem Solving with Large Language Models" (paper)
- Build: Every concept in this guide is implemented in Jazper — use building it as your learning lab
