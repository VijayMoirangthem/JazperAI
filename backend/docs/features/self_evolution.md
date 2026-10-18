# Self-Evolution System

Sir Jazper OS allows any agent to modify itself and the entire codebase through tool-calling. This document covers the architecture, security model, and how to use it.

---

## How It Works

When you chat with an agent (e.g. Jazper, Forge, Darwin), the agent receives a set of 16 tools alongside its system prompt. The LLM decides when to call tools, executes them via Groq function-calling, and the results feed back into the conversation.

Because the backend runs with `uvicorn --reload` and the frontend uses Next.js HMR:
- Agent writes a `.py` file → backend restarts in ~1s
- Agent writes a `.tsx` file → browser reloads the component instantly

This enables **real-time self-modification** — Jazper can write new features and you see them live.

---

## The 16 Tools

### Inspection (read-only)
| Tool | Description |
|------|-------------|
| `list_agents` | List agents, optionally filtered by dept/status |
| `get_agent_info` | Full agent profile: prompt, voice, model, settings |
| `list_departments` | All departments with head agent and member count |

### Agent Mutation
| Tool | Description | Requires Approval |
|------|-------------|------------------|
| `create_agent` | Spawn a new agent (active immediately) | No |
| `update_agent_settings` | Change model, temperature, system prompt, voice | No |
| `update_agent_status` | Set agent to active/standby | No |
| `delete_agent` | Terminate an agent (sets status=terminated) | **Yes** |

### Department Mutation
| Tool | Description |
|------|-------------|
| `update_dept_settings` | Change dept name, description, enabled state |

### File System
| Tool | Description | Requires Approval |
|------|-------------|------------------|
| `list_files` | List files in a directory (glob filter supported) | No |
| `read_file` | Read file contents (with line range) | No |
| `write_file` | Create or overwrite any project file | **Yes** |

### Terminal
| Tool | Description | Requires Approval |
|------|-------------|------------------|
| `run_command` | Execute shell command in project dir | No |
| `install_package` | `pip install` or `npm install` | **Yes** |

### Web
| Tool | Description |
|------|-------------|
| `web_search` | DuckDuckGo search (ddgs library) |

### Memory
| Tool | Description |
|------|-------------|
| `save_memory` | Save persistent key-value note for this agent |
| `recall_memory` | Search/retrieve saved memories |

---

## Approval Gate

Three tools require explicit approval before execution:
- `write_file` — modifying any project file
- `install_package` — installing Python or npm packages
- `delete_agent` — terminating an agent

**Flow:**
1. Agent calls a risky tool
2. Backend calls `approval_service.request_approval()`
3. SSE frame `[APPROVAL]{id, name, approval_id}` sent to frontend
4. Chat bubble shows `⏳ approval needed` on the tool pill
5. `ApprovalOverlay` modal appears globally
6. VJ clicks Approve or Deny
7. Stream resumes: tool executes (or denial message returned to agent)

To skip approval for specific tools, use the **Settings → Approvals** panel to add them to the auto-approve list.

---

## Evolution Log

Every mutation is recorded in `evolution_log`:
- Who called it (`agent_codename`)
- What they did (`action_type`)
- What they targeted (`target` — file path, codename, command, etc.)
- What args were passed (`payload` — content omitted for large file writes)
- Whether it succeeded (`outcome`)

View the log at `/evolution` in the UI.

API: `GET /api/evolution?limit=50&agent=jazper&action_type=write_file`

---

## Security Constraints

- Path traversal blocked: `_resolve_safe()` validates all paths stay within project root
- `.env` files cannot be written by any agent
- Jazper (`codename=jazper`) cannot be deleted
- Blocked shell patterns: `rm -rf`, `rmdir /s`, `shutdown`, `reboot`, fork bombs
- All agent file/command operations are scoped to `PROJECT_ROOT` only

---

## Example: Ask Jazper to Add a New Route

```
You: "Jazper, add a new route /api/hello that returns {"message": "Hello from Sir Jazper OS"}"

Jazper:
  [🔍 Reading backend/python/main.py…]  ← read_file
  [✎ Writing backend/python/app/routes/hello.py…]  ← write_file (needs approval)
  [✎ Writing backend/python/main.py…]  ← write_file (needs approval)
  "Done! I've created the route and registered it. Backend is reloading..."
```

Both writes trigger the approval gate, uvicorn auto-reloads, and the route is live.

---

## Agent Memory

Each agent has its own key-value memory store in `agent_memory`:
- `save_memory(key, content, category)` — upserts a memory entry
- `recall_memory(key?, category?, search?)` — retrieves stored memories

Categories: `preference`, `decision`, `fact`, `task`, `observation`

Memory persists across conversations and is available to the agent on every chat.
