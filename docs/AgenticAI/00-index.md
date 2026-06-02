# Sir Jazper — Agentic AI Knowledge Base

A complete reference from first principles to production implementation.
Use this as both a study guide for interviews and a blueprint for building Jazper's agentic layer.

---

## Document Map

| # | Document | What You'll Learn |
|---|----------|-------------------|
| 01 | [What Is Agentic AI](./01-what-is-agentic-ai.md) | Core concepts, definitions, how agents differ from chatbots |
| 02 | [Agent Architecture](./02-agent-architecture.md) | Components of an agent, the perception-action loop, agent types |
| 03 | [Reasoning Patterns](./03-reasoning-patterns.md) | ReAct, CoT, ToT, Self-Reflection, and 8 other cognitive architectures |
| 04 | [Memory Systems](./04-memory-systems.md) | 6 types of agent memory, how they're stored, retrieval strategies |
| 05 | [Tools & Tool Loops](./05-tools-and-tool-loops.md) | Function calling, tool design, the execution loop |
| 06 | [Multi-Agent Systems](./06-multi-agent-systems.md) | Orchestrators, specialists, supervisor patterns, communication |
| 07 | [Jazper Agentic Roadmap](./07-jazper-roadmap.md) | Specific implementation plan for Sir Jazper OS |
| 08 | [Interview Prep](./08-interview-prep.md) | 40+ Q&A covering concepts, architecture, and real-world trade-offs |

---

## Quick Concept Map

```
YOU
 │
 ▼
┌─────────────────────────────────────────────────┐
│              JAZPER  (Orchestrator)              │
│  • Receives your goal                           │
│  • Decomposes into a plan                       │
│  • Decides which tools/agents to invoke         │
│  • Synthesizes final response                   │
└─────────┬──────────────────┬────────────────────┘
          │                  │
    ┌─────▼──────┐    ┌──────▼──────┐
    │  Research  │    │  JobApply   │   ← Specialist
    │   Agent    │    │   Agent     │     Sub-Agents
    └─────┬──────┘    └──────┬──────┘
          │                  │
    ┌─────▼──────────────────▼──────┐
    │         MEMORY LAYER          │
    │  Core | Episodic | Semantic   │
    │  Procedural | Working | Cache │
    └───────────────────────────────┘
          │
    ┌─────▼──────┐
    │   TOOLS    │  Web search, DB queries,
    │   LAYER    │  Gmail, File I/O, APIs
    └────────────┘
```

---

## How to Use This

- **Learning Jazper AI**: Read 01 → 02 → 03 → 04 in order
- **Building the system**: Start with 07 (roadmap), then reference others
- **Interview prep**: Read 08 last — it assumes the other docs as background
- **Quick reference**: Each doc has a Summary section at the top

---

## Current Jazper Status

| Layer | Status | Notes |
|-------|--------|-------|
| Single-turn chat | ✅ Done | Streaming, SSE |
| Tool calling | ✅ Done | Function call loop in chat.py |
| Core memory | ✅ Done | PostgreSQL core_memories |
| Extracted memory | ✅ Done | Auto-extracted per session |
| Tasks / scheduling | ✅ Done | APScheduler + DB |
| **ReAct loop** | 🔜 Next | Multi-step tool execution |
| **Semantic memory** | 🔜 Next | pgvector embeddings |
| **Sub-agents** | 🔜 Phase 2 | Specialist prompts |
| **Planner** | 🔜 Phase 3 | Goal decomposition |
| **Background agents** | 🔜 Phase 3 | Autonomous scheduled work |
