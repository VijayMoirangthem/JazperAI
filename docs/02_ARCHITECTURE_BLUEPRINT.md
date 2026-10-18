# 02 — System Architecture Blueprint (Sir Jasper AI)

All elements trace to `Sir Jasper AI.docx` (§N). Where the spec is silent, the item is tagged **[assumption]**.

## 1. Target repository layout

```
COOS/
├── backend/
│   ├── api/        FastAPI routers, /ws JSON-RPC endpoint, tunnel-safe auth        (§6, §12)
│   ├── agents/     jasper/, executives/, crews/{it,baeit,boardmint,rnd,coreops,people,personal}/,
│   │               graphs/ (LangGraph), improvement/ (PIP)                          (§2, §19)
│   ├── core/       config, vault (OS keystore), event_bus, finops, hitl, telemetry   (§11, §12)
│   ├── memory/     pg (SQLAlchemy+Alembic, pgvector), redis (cache/pubsub/locks)     (§4)
│   └── mcp/        registry, supervisor, sandbox runners, connectors/*               (§12, §14)
├── frontend/       Electron main/preload + React renderer (Monaco, office, chat)    (§7)
├── infra/          docker-compose.yml (postgres+pgvector, redis ONLY), migrations/    (§12)
├── storage/        vector indices, artifacts, scratchpads  — fully git-ignored        (§2)
└── docs/
```

## 2. Agent topology (Sir Jasper → CEOs → sub-crews → hybrid humans)

```mermaid
flowchart TB
  F([Founder / Human]):::human
  SJ["Sir Jasper<br/>L1 Chief Orchestrator<br/>(LangGraph supervisor)"]
  PA["Personal Assistant Sub-Crew<br/>schedule · research · travel/lifestyle"]
  F <--> SJ
  SJ --> PA

  subgraph L2["L2 Executive Leadership (reports to Sir Jasper)"]
    COCEO["CEO — Create Origins<br/>(parent / holding)"]
    BCEO["CEO / Product Lead — Baeit"]
    BMLEAD["Chief Governance Officer — Boardmint"]
    VPT["VP Technology & Operations<br/>(cross-entity IT)"]
  end
  SJ --> COCEO & BCEO & BMLEAD & VPT

  subgraph PARENT["Create Origins parent tier (§16)"]
    CFO[CFO / Treasury & FinOpsBot]
    COO[COO]
    GC[General Counsel]
  end
  COCEO --> CFO & COO & GC

  subgraph L3["L3 Modular Sub-Crews (CrewAI crews; hot-pluggable)"]
    IT["IT & Core Systems<br/>Infra/DevOps · Desktop UI · Enterprise Architect"]
    BE["Baeit Eng & Ops<br/>Mobile Dev · Backend Svc · Partner Ops · QA/Sim"]
    BM["Boardmint Compliance<br/>Legal&Compliance · Doc Archival · Corp Secretary"]
    RD["R&D & Innovation<br/>Prototyping · Tool Discovery · Algo Experiments"]
    CO["Central Ops<br/>Fast Cache/State Router · Task Dispatcher · Incident Response"]
    PO["Corporate Ops & People Ops<br/>TravelOpsBot · PeopleOpsBot"]
    SRE["SRE / ChaosBot / FinOpsBot"]
  end
  COCEO --> IT
  VPT --> IT
  BCEO --> BE
  BMLEAD --> BM
  SJ --> RD
  VPT --> RD
  SJ --> CO
  SJ --> PO
  COCEO --> PO
  VPT --> SRE
  CO --> SRE

  subgraph HYB["Hybrid human roles (§25) — first-class directory identities"]
    HEMP["Employees / Contractors / Interns<br/>(per division, RLS-scoped)"]:::human
    HLEAD["Designated human counterparts<br/>(Tier-3 approvers: CA, CS, counsel)"]:::human
  end
  BE <-. "bi-directional handoff" .-> HEMP
  BM <-. "Tier-3 escalation" .-> HLEAD
  IT <-. handoff .-> HEMP
  SJ -. "matrix dual-report (§20)" .-> VPT
  VPT -. dual-line .-> BCEO
  GC -. dual-line .-> BMLEAD

  classDef human fill:#fde68a,stroke:#b45309,color:#000
```

Notes: Matrix (dotted dual-reporting) per §20; subsidiaries Baeit/Boardmint have their own HR/Legal/CS/CA units (§16) instantiated as additional crews under their lead **[assumption: modelled as optional crews, not first-class L2 nodes]**. R&D reports to Sir Jasper *or* Head of Tech (§2). Dev-loop bots (Mobile/Backend/QA) run the LangGraph cycle in §5.

## 3. Bidirectional IPC / WebSocket event loop

```mermaid
sequenceDiagram
  autonumber
  participant EL as Electron main (preload IPC)
  participant R as React renderer / Chat UI
  participant M as Monaco (diff editor)
  participant API as FastAPI /ws (JSON-RPC 2.0)
  participant BUS as Event Bus (Redis pub/sub)
  participant AG as Agent Swarm (LangGraph + CrewAI)
  participant HITL as HITL Gate

  R->>EL: ipcRenderer.invoke(auth/token, openFile)
  EL-->>R: OS keystore token, fs handle
  R->>API: ws connect + rpc "session.subscribe" {topics}
  API->>BUS: SUBSCRIBE agent-state-change, diff-stream, human-intervention-request, execution-log
  R->>API: rpc "task.submit" {to: sir_jasper, trace_id}
  API->>AG: dispatch (trace_id, parent_id)
  AG->>BUS: PUBLISH agent-state-change {agent, state}
  BUS-->>API: fan-out
  API-->>R: notify agent-state-change   (<100 ms target)
  AG->>BUS: PUBLISH diff-stream {path, hunks, seq}
  API-->>M: notify diff-stream
  M->>API: rpc "diff.decision" {accept|reject, hunk_ids}
  API->>AG: resume graph with decision
  AG->>HITL: tier=3 action requested
  HITL->>BUS: PUBLISH human-intervention-request
  API-->>R: notify human-intervention-request
  R->>API: rpc "hitl.respond" {approved, approver_id}
  API->>AG: resume
  AG->>BUS: PUBLISH execution-log (append-only, hash-chained)
  BUS-->>API: fan-out
  API-->>R: notify execution-log
```

Principles: one `/ws` per client; JSON-RPC 2.0 requests (client→server), notifications (server→client), correlation by `trace_id` + `parent_id` (§17). Sub-100 ms budget (§12) applies to publish→render for the four topics; measured via OTel span `event.deliver`. LSP bridging for Monaco is a second channel `/lsp` **[assumption: spec says "WebSocket/LSP"]**. Mobile (Android) uses the same `/ws` via Cloudflare Tunnel/ngrok with token auth (§6).

## 4. Unified memory lifecycle

```mermaid
flowchart LR
  subgraph EPH["Tier 1: Agent context (ephemeral)"]
    CW[Local context window / exec trace]
  end
  subgraph RED["Tier 3: Redis (volatile, real-time)"]
    PS[(pub/sub bus)]
    LK[(session locks)]
    SP[(scratchpads / convos hot)]
    TC[(trace cache, token counters)]
  end
  subgraph PG["Tier 2: PostgreSQL + pgvector (persistent)"]
    REL[(relational: tenants, org, tasks, users, RBAC)]
    VEC[(pgvector embeddings per tenant namespace)]
    AUD[(append-only audit / ledger / RCA)]
  end
  SAN["PII sanitizer<br/>(pre-ingestion redaction)"]
  EMB[Embedding service]
  DR[("Cold DR: encrypted offsite<br/>snapshots + PITR (WAL)")]
  EDGE[("SQLite offline queue<br/>(edge mode §23)")]

  CW -->|summarize on turn end| SP
  SP <--> PS
  PS --> TC
  SP -->|"flush on thread close / TTL"| SAN --> EMB --> VEC
  SAN --> REL
  PS -->|"every event"| AUD
  REL <--> VEC
  REL & VEC & AUD -->|"nightly snapshot + WAL archive"| DR
  DR -.->|"restore / PITR / spinoff export"| REL
  EDGE -. "reconcile on reconnect" .-> REL
  SP -. "Redis down → fallback" .-> EDGE
  REL -. "RTBF / TTL: cryptographic erase" .-> VEC
```

Rules: nothing reaches `VEC`/`REL` without the sanitizer (§15, §25). Each tenant (Create Origins, Baeit, Boardmint) has its own schema + RLS; vector rows carry `tenant_id` and are filtered by RLS (§11). Audit table is insert-only with hash chain (§17). Redis keys namespaced `tenant:{id}:…` with TTLs; token counters feed FinOps (§23).

## 5. Bounded self-healing dev loop (LangGraph) — §3 Flow 1, §10

```mermaid
stateDiagram-v2
  [*] --> Plan
  Plan --> Implement: tier-2 branch agent-patch/*
  Implement --> Verify: sandbox (ephemeral Docker, no host write)
  Verify --> Done: tests pass
  Verify --> Repair: fail and attempt < 3
  Repair --> Verify
  Verify --> Rollback: fail and attempt == 3
  Rollback --> Escalate: git checkout, post-mortem to Redis/pgvector
  Done --> HITL: main merge = tier 3
  Escalate --> [*]: notify Sir Jasper → Founder
  HITL --> [*]
```

## 6. Cross-cutting services

| Concern | Design | Spec |
|---|---|---|
| Inference | Provider abstraction; Claude primary; tiered routing (cheap model for classify/route, frontier for orchestration/AST repair); prompt caching; circuit breaker on budget/quota; fallback chain; Ollama/llama.cpp only as Tier-1 offline fallback | §5, §11, §23 |
| FinOps | Per call: `tenant, agent, crew, model, in/out tokens, cost`; Redis counters (hot) → PG ledger; soft/hard caps per request/day per division; `breaker.open` event halts loops | §11, §23 |
| HITL | Central policy table `action → tier`; Tier 1 auto, Tier 2 notify, Tier 3 block until `hitl.respond` | §11, §13, §14 |
| Vault | Windows Credential Manager/DPAPI via `keyring`; no secrets in `.env` except bootstrap; OAuth loopback with refresh rotation | §11, §14 |
| MCP hub | Registry in PG; supervisor spawns connector subprocess/container; capability handshake → tools registered into agent registry → `tool-registry-changed` event; per-connector scopes + rate budgets + audit | §12, §14 |
| Observability | OpenTelemetry spans across LangGraph nodes & CrewAI tasks; Langfuse/LangSmith exporter optional; Prometheus metrics; Grafana optional | §12, §22, §23 |
| SRE | SLIs: Tier-1 latency <2000 ms, multi-hop <15 s, tool success >99.5 %; error-budget burn → freeze non-critical autonomous commits; runbooks as versioned YAML executed by IncidentResponseBot | §22 |
| Chaos | ChaosBot injects faults only in staging/sandbox; asserts recursion cap and rollback hooks | §21 |
| Compliance | SBOM + license gate pre-merge (GPL/AGPL block), commit provenance signatures, snippet-similarity check, retention TTL + RTBF + crypto-erase | §15 |
| Spinoff | Per-tenant export: pg_dump of tenant schema + pgvector rows + git history + logs → bundle | §12, §16 |
| Onboarding | Role spec → synthetic interview → benchmark → clearance → registry + memory namespace + office avatar; start Tier 1/2 only; PIP loop on SLA breach | §18, §19 |

## 7. Service topology (host)

```mermaid
flowchart LR
  subgraph Host["Workstation"]
    EL[Electron + React] --- API[FastAPI :8000]
    API --- PGC[(Postgres+pgvector :5433)]
    API --- RDC[(Redis :6379)]
    API --- MCPS[MCP connector subprocesses/containers]
    API --- SBX[Ephemeral Docker sandboxes]
    API --- STO[(storage/ local)]
  end
  TUN[Cloudflare Tunnel / ngrok] --- API
  AND[Android client] --- TUN
  API --- CLOUD[(Claude / fallback providers)]
```
Docker Compose runs **only** Postgres+pgvector and Redis (§12). FastAPI, Electron and workers run as host processes under a supervisor with health checks and graceful shutdown (§12).

## 8. Open questions (spec ambiguity)
1. §2 lists "Hermes Agent" as both a module and a PIP engine — treated as a library/pattern, not a service.
2. §16 subsidiary HR/Legal/CS/CA units vs §2 sub-crews overlap (e.g., Corporate Secretary Bot). Proposed: *bot = role instance inside a tenant crew*.
3. §7 says "Phaser"; the repo uses Pixi. Spec governs unless you decide otherwise (Pixi is already integrated).
4. §5 says no local LLM weights, §23 wants Ollama fallback — reconciled as "edge-only, off by default".
