# COOS AI-Native IDE — Current Status & Audit

**Last Updated:** 2026-08-11  
**Status:** Audit Complete — Phase 1 Planning  
**Location in COOS:** `Agent OS` → `IDE` (`/api/ide`, `IDEPanel.tsx`)

---

## 1. Existing Infrastructure Audit

### Backend (`backend/python/app/routes/ide.py`)
- **File System API:**
  - `GET /api/ide/tree`: Returns JSON tree up to max depth 6 (skips `.git`, `node_modules`, `.next`, `__pycache__`, `.venv`).
  - `GET /api/ide/file?path=...`: Reads text file (max 1 MB limit, path traversal protected).
  - `PUT /api/ide/file?path=...`: Writes text file content.
- **Git Integration:**
  - `GET /api/ide/git/status`: Short status (`git status --short`).
  - `GET /api/ide/git/diff`: Staged and unstaged diff (`git diff`).
  - `GET /api/ide/git/log?n=...`: Recent commit log.
  - `POST /api/ide/git/commit`: Stage all/selected files and commit with message.
- **Realtime Observability & Patching:**
  - `GET /api/ide/events`: SSE stream emitting file activity events from `ide_bus`.
  - `GET /api/ide/active-files`: Returns map of files currently touched by active agents.
  - `POST /api/ide/apply-patch`: Applies string replacements to files.

### Frontend (`frontend/src/components/panels/IDEPanel.tsx`)
- **File Explorer:** Left-side collapsible tree with file icons & language detection.
- **Code Editor:** Integrated `@monaco-editor/react` (VS-Dark theme) with multi-tab support, dirty state tracking, and `Ctrl+S` save shortcut.
- **Git Widget:** Working tree change counter, status preview, commit message textarea, and recent commit history.
- **Activity Feed:** Live SSE feed showing agent actions (reading, editing, creating, running commands, diff previews).

---

## 2. Reusable Core Components

| Component | Status | Reuse Plan |
|---|---|---|
| Monaco Editor | ✅ Production ready | Reuse as core editor component; extend for diff views & AI inline widgets. |
| File Tree API | ✅ Production ready | Reuse for project explorer; enhance for multi-repository / project workspace support. |
| `ide_bus` Event Stream | ✅ Production ready | Reuse for real-time agent execution monitoring inside the IDE UI. |
| Approval System | ✅ Production ready | Reuse `approval_service` for destructive agent commands and file write gates. |
| Agent Tools Registry | ✅ Production ready | Reuse `agent_tools.py` (16 tools) & extend with IDE-specific tool contracts. |

---

## 3. Gap Analysis

| Feature | Current State | Target State | Gap |
|---|---|---|---|
| **Multi-Project Workspace** | Single hardcoded root (`_PROJECT_ROOT`) | Switchable workspaces / client projects | Needs project workspace isolation & dynamic root binding |
| **Terminal Integration** | Absent | Integrated `xterm.js` via WebSocket / FastAPI | Needs WebSocket terminal transport & PTY runner |
| **Browser Automation & Preview** | Separate `browser` tool | Live embedded application preview + Playwright automation agent | Needs iframe preview + Playwright DOM inspection runner |
| **AI Modes** | Single Chat / ReAct loop | Ask, Plan, Edit, Debug, Review, Autonomous modes | Needs explicit UI selector + system prompt router per mode |
| **Codebase Indexing (RAG)** | Raw `read_file` & simple vector store | Tree-sitter AST parsing + pgvector semantic search + ripgrep | Needs code-aware indexing pipeline |
| **Docker Isolation** | Local host execution | Isolated container workspace for builds & untrusted agent commands | Needs Docker runner integration |

---

## 4. Immediate Next Steps

1. Establish formal architecture specifications under `/docs/agent-os/`.
2. Define implementation roadmap across Phases 1–11.
3. Update main COOS documentation (`index.md`, `project_status.md`).
4. Begin Phase 1 (IDE Foundation: Project selection, xterm.js terminal integration, AI mode switching).
