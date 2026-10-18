# COOS AI-Native IDE — Technology Stack

**Last Updated:** 2026-08-11  
**Architecture:** Hybrid Web-Native & Server Orchestrated

---

## Technical Stack Overview

| Layer | Component | Selection | Rationale |
|---|---|---|---|
| **Frontend UI** | Framework | Next.js 14 (App Router), React 19, TypeScript | Matches existing COOS frontend stack |
| **Code Editor** | Editor Component | `@monaco-editor/react` (Monaco Editor) | Production standard for browser IDEs with syntax highlighting, diff view, & diagnostics |
| **Terminal** | Web Terminal | `xterm.js` + `xterm-addon-fit` | Fast, canvas-rendered terminal emulator |
| **Backend API** | App Server | Python 3.11, FastAPI (ASGI), Uvicorn | Async I/O, WebSockets, background workers, Python AI ecosystem |
| **Database** | Relational & Vector | PostgreSQL 16 + pgvector | Unified database for relational project metadata + vector code indexing |
| **Cache & Realtime** | Cache / PubSub | Redis 7 | Session state, event distribution, job queues |
| **Object Storage** | Artifact Storage | MinIO (S3-compatible) | Code artifacts, build logs, screenshots, exported snapshots |
| **Code Indexing** | AST & Search | Tree-sitter + ripgrep | Code-aware syntax parsing and fast regex searching |
| **Browser Automation**| Browser Agent | Playwright (Node/Python) | Headless/headed browser control, DOM inspection, network intercept |
| **Model Inference** | Local Serving | LM Studio / Ollama (OpenAI API compat) | Privacy-first, local-first LLM execution (`qwen/qwen3.5-9b`, `gemma`) |
| **Containerization** | Isolation | Docker / Docker Compose | Safe execution of untrusted build commands and sandboxed tasks |
