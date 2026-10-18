# COOS AI-Native IDE — Implementation Roadmap

**Last Updated:** 2026-08-11  
**Status:** Multi-Phase Strategic Development Plan

---

## Roadmap Overview

```text
Phase 1: IDE Foundation & UX Restructuring   [Current Focus]
Phase 2: Codebase Context & AI Code Understanding (RAG)
Phase 3: Safe AI Code Editing & Patching Engine
Phase 4: Execution Engine & xterm.js Terminal
Phase 5: Browser Agent & Live Application Preview
Phase 6: QA Loop & Auto-Fixing Engine
Phase 7: Full Agentic Software Engineering Workflow
Phase 8: Mobile Development Support (React Native / Android SDK)
Phase 9: Visual Debugging & Multi-Modal Vision
Phase 10: Self-Fixing & Isolated Docker Sandbox
Phase 11: Self-Evolution & Optimization Engine
```

---

## Detailed Phase Breakdown

### Phase 1 — IDE Foundation & Workspace Restructuring
- Restructure `IDEPanel.tsx` into a multi-pane layout: File Tree + Monaco Editor + Agent Command Panel + Bottom Terminal/Output Panel.
- Multi-project workspace selector (binds backend path dynamically instead of single hardcoded root).
- Mode selector in AI panel (Ask, Plan, Edit, Execute, Debug, Review).

### Phase 2 — Codebase Context & Code Understanding (RAG)
- Integrate Tree-sitter and ripgrep for AST and keyword indexing.
- Index source files, READMEs, and architecture docs in pgvector.
- Provide intelligent context selection (selected code + active file + RAG results) per prompt.

### Phase 3 — Safe AI Code Editing & Patching Engine
- Implement structured file operations (`read`, `search`, `patch`, `create`, `delete`).
- Diff viewer modal / Monaco DiffEditor for reviewing proposed agent edits before applying.
- Integrate with approval system (`approval_service`) for risky modifications.

### Phase 4 — Execution Engine & Integrated Terminal
- Integrate `xterm.js` in frontend with FastAPI WebSocket PTY backend.
- Command execution tool with permission controls (`run_command`).
- Live process monitoring for development servers (`npm run dev`, `uvicorn`).

### Phase 5 — Browser Agent & Application Preview
- Integrate Playwright for automated browser testing and inspection.
- Auto-detect dev server ports (e.g. `localhost:3000`, `localhost:5173`) and embed live preview iframe inside the IDE.
- DOM inspection, console log capture, and network error tracking tools for AI.

### Phase 6 — QA Loop & Auto-Fixing Engine
- Test runner tool (`run_tests`, `run_typecheck`, `run_linter`).
- Automated failure diagnosis loop: Error detected → Oracle diagnoses → Forge fixes → Shield validates → Commits.

### Phase 7 — Full Agentic Software Engineering Workflow
- Orchestrate 7 specialized agents under Jazper: Software Architect, Developer, QA, Code Review, UI/UX, DevOps, Research.
- End-to-end user goal execution ("Jazper, build a client dashboard") with plan confirmation.

### Phase 8 — Mobile Development Support
- Support React Native / Android SDK workflows (`adb`, `gradle`, Metro bundler).
- Mobile device / emulator log streaming into COOS IDE.

### Phase 9 — Vision & Multi-Modal UI Debugging
- Capture browser preview screenshots and feed to Vision models.
- UI overlap detection, layout regression checks, and design system validation.

### Phase 10 — Isolated Sandboxing & Self-Fixing
- Docker container worktree isolation for running untrusted code and automated bug fixes.
- Isolated Git branch creation (`ai/fix-...`) and automated pull request generation.

### Phase 11 — Self-Evolution & Performance Optimization
- Benchmark agent execution metrics, tool success rates, and token costs.
- Propose codebase and prompt optimization tickets to `evolution_log`.
