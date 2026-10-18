# COOS AI-Native IDE — System Architecture

**Last Updated:** 2026-08-11  
**Architecture Type:** Event-Driven AI Software Engineering System  
**Parent System:** COOS Agent OS (`Agent OS` → `IDE`)

---

## 1. System High-Level Topology

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│                          USER INTERFACE (Next.js)                           │
│  ┌──────────────┐  ┌─────────────────────────┐  ┌────────────────────────┐  │
│  │ File Explorer│  │  Monaco Editor / Preview│  │  AI Agent Command Panel│  │
│  └──────┬───────┘  └────────────┬────────────┘  └───────────┬────────────┘  │
│         │                       │                           │               │
│  ┌──────┴───────────────────────┴───────────────────────────┴────────────┐  │
│  │                     xterm.js Terminal / Output                        │  │
│  └──────────────────────────────┬────────────────────────────────────────┘  │
└─────────────────────────────────┼───────────────────────────────────────────┘
                                  │ WebSockets / SSE / REST APIs
┌─────────────────────────────────┴───────────────────────────────────────────┐
│                           COOS FASTAPI BACKEND                              │
│                                                                             │
│  ┌──────────────────┐   ┌────────────────────┐   ┌───────────────────────┐  │
│  │   Jazper AI      │   │  Software Agent    │   │  Model Router &       │  │
│  │   Orchestrator   ├───►  Fleet (7 Agents)  ├───►  Fallback System      │  │
│  └────────┬─────────┘   └─────────┬──────────┘   └───────────────────────┘  │
│           │                       │                                         │
│           │             ┌─────────┴──────────┐                              │
│           │             │ Tool Execution     │                              │
│           │             │ Engine             │                              │
│           │             └─────────┬──────────┘                              │
│           │                       │                                         │
│  ┌────────▼───────────────────────▼──────────────────────────────────────┐  │
│  │     Tool Layer: Git · File Ops · Terminal (PTY) · Playwright · Docker  │  │
│  └────────────────────────────────┬──────────────────────────────────────┘  │
└───────────────────────────────────┼─────────────────────────────────────────┘
                                    │
┌───────────────────────────────────▼─────────────────────────────────────────┐
│                        DATA & STORAGE LAYER                                 │
│  PostgreSQL (pgvector) · Redis Sessions · MinIO Artifacts · Git Workspace   │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Core Architectural Principles

1. **Jazper as Orchestrator:** Jazper receives intent, builds high-level goals, and delegates to specialized engineering agents (Architect, Developer, QA, Code Review, UI/UX, DevOps, Research).
2. **Layered Agent Execution:**  
   `Jazper → Planner → Specialized Agent → Controlled Tools → Execution Layer → Result → Jazper`
3. **Local-First with Cloud Escalation:**  
   Local models (Qwen, Gemma via LM Studio/Ollama) process low-latency and routine tasks; cloud models are optionally escalated for complex architectural reasoning.
4. **Structured Tool Interfaces:** Agents act through strictly validated tools (`read_file`, `patch_file`, `run_command`, `git_commit`, `inspect_dom`) with full audit logging and approval gates for destructive actions.
5. **Cross-System Integration:** Connects seamlessly with COOS Productivity (Tasks/Sprints), Business (Client Projects), Intelligence (RAG/Knowledge), and Communications (Gmail/Calendar).

---

## 3. Communication Protocols

- **REST APIs:** File tree operations, project metadata CRUD, model cost metrics.
- **WebSockets (`/ws`):** Interactive PTY terminal sessions (`xterm.js`), live browser DOM events, bidirectional agent feedback.
- **Server-Sent Events (`/api/ide/events`):** Real-time streaming of agent file actions, diff generations, and tool logs to the frontend UI.
