"""
Agent tool definitions and execution for Groq function-calling.
All agents can call these tools to read, modify, and extend Sir Jazper OS.

Tools are organized into tiers:
  - System inspection  : list_agents, get_agent_info, list_departments
  - System mutation    : update_agent_settings, update_agent_status,
                         update_dept_settings, create_agent, delete_agent
  - File system        : read_file, write_file, list_files
  - Terminal           : run_command, install_package
  - Web                : web_search
  - Memory             : save_memory, recall_memory
"""

import json
import re
import sys
import subprocess
import psycopg2
import structlog
from pathlib import Path
from core.config import settings

log = structlog.get_logger()

# Project root — 5 levels up from this file's location:
# backend/python/api/routes/agent_tools.py → SirJazper/
PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent.parent.parent


def _workspace_root() -> Path:
    """
    File/exec tools (read_file, write_file, list_files, run_command) operate
    against whichever project the IDE's workspace selector currently points
    at — not always SirJazper's own repo. Falls back to PROJECT_ROOT if the
    IDE module hasn't set a workspace (e.g. running outside the IDE).
    """
    try:
        from api.routes import ide as _ide_route
        return _ide_route._CURRENT_WORKSPACE.resolve()
    except Exception:
        return PROJECT_ROOT.resolve()

# Commands that are always blocked regardless of context
_BLOCKED_PATTERNS = [
    r"\brm\s+-rf\b", r"\brmdir\s+/s\b", r"\bdel\s+/[sf]\b",
    r"\bformat\s+[a-z]:", r"\bmkfs\b", r"\bdd\s+if=",
    r">\s*/dev/", r"\bshutdown\b", r"\breboot\b", r"\bhalt\b",
    r":\(\)\s*\{.*\}",
]


# ── Tool schema (OpenAI / Groq function-calling format) ───────────────────────

TOOLS = [
    # ── Inspection ────────────────────────────────────────────────────────────
    {
        "type": "function",
        "function": {
            "name": "list_agents",
            "description": "List all agents in the OS, optionally filtered by department or status.",
            "parameters": {
                "type": "object",
                "properties": {
                    "department": {
                        "type": "string",
                        "description": "Department ID to filter by (e.g. 'intelligence', 'it'). Omit for all."
                    },
                    "status": {
                        "type": "string",
                        "enum": ["active", "standby", "terminated", "all"],
                        "description": "Filter by status. Default: all."
                    }
                }
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "get_agent_info",
            "description": "Get full details about a specific agent: role, settings, system prompt, voice config.",
            "parameters": {
                "type": "object",
                "properties": {
                    "codename": {"type": "string", "description": "Agent codename (e.g. 'scout', 'phantom')"}
                },
                "required": ["codename"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "list_departments",
            "description": "List all departments with their status, head agent, and agent count.",
            "parameters": {"type": "object", "properties": {}}
        }
    },

    # ── Agent mutation ────────────────────────────────────────────────────────
    {
        "type": "function",
        "function": {
            "name": "create_agent",
            "description": (
                "Spawn a brand-new agent in the Sir Jazper OS fleet. "
                "The agent is immediately active and chatttable after creation."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "codename":    {"type": "string", "description": "Short unique lowercase codename (e.g. 'cipher')"},
                    "name":        {"type": "string", "description": "Display name (e.g. 'Cipher')"},
                    "title":       {"type": "string", "description": "Role title (e.g. 'Cryptography Specialist')"},
                    "department":  {"type": "string", "description": "Department ID this agent belongs to"},
                    "level": {
                        "type": "integer",
                        "description": "Rank: 1=executive, 2=head, 3=senior, 4=specialist, 5=junior"
                    },
                    "system_prompt": {
                        "type": "string",
                        "description": "The agent's full personality and instructions. Be detailed and in-character."
                    },
                    "model": {
                        "type": "string",
                        "enum": ["llama-3.1-8b-instant", "llama-3.3-70b-versatile", "llama-3.1-70b-versatile", "mixtral-8x7b-32768", "gemma2-9b-it"],
                        "description": "LLM model. Use 8b-instant for lightweight agents, 70b-versatile for complex reasoning."
                    },
                    "description": {"type": "string", "description": "One-sentence description of what this agent does"},
                    "emoji":       {"type": "string", "description": "Avatar emoji (e.g. '🔐')"},
                    "badge_color": {"type": "string", "description": "Hex badge color (e.g. '#10b981')"}
                },
                "required": ["codename", "name", "department", "system_prompt"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "update_agent_settings",
            "description": "Update an agent's settings. Only include fields you want to change.",
            "parameters": {
                "type": "object",
                "properties": {
                    "codename": {"type": "string"},
                    "system_prompt_override": {
                        "type": "string",
                        "description": "New custom personality. Pass empty string to revert to base prompt."
                    },
                    "model": {
                        "type": "string",
                        "enum": ["llama-3.1-8b-instant", "llama-3.3-70b-versatile", "llama-3.1-70b-versatile", "mixtral-8x7b-32768", "gemma2-9b-it"]
                    },
                    "temperature": {"type": "number", "description": "0.0 (precise) to 1.5 (creative)"},
                    "max_tokens":  {"type": "integer", "description": "Max tokens per response (128-8192)"},
                    "voice_prosody": {
                        "type": "object",
                        "description": "{\"pitch\": 0.5-2.0, \"rate\": 0.5-2.0}",
                        "properties": {"pitch": {"type": "number"}, "rate": {"type": "number"}}
                    }
                },
                "required": ["codename"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "update_agent_status",
            "description": "Activate or put an agent on standby.",
            "parameters": {
                "type": "object",
                "properties": {
                    "codename": {"type": "string"},
                    "status":   {"type": "string", "enum": ["active", "standby"]}
                },
                "required": ["codename", "status"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "delete_agent",
            "description": "Permanently decommission an agent (sets status to 'terminated'). Cannot delete Jazper.",
            "parameters": {
                "type": "object",
                "properties": {
                    "codename": {"type": "string"},
                    "reason":   {"type": "string", "description": "Why this agent is being decommissioned"}
                },
                "required": ["codename"]
            }
        }
    },

    # ── Department mutation ───────────────────────────────────────────────────
    {
        "type": "function",
        "function": {
            "name": "update_dept_settings",
            "description": "Update a department's name, description, or enable/disable it.",
            "parameters": {
                "type": "object",
                "properties": {
                    "dept_id":     {"type": "string"},
                    "name":        {"type": "string"},
                    "description": {"type": "string"},
                    "enabled":     {"type": "boolean"}
                },
                "required": ["dept_id"]
            }
        }
    },

    # ── File system ───────────────────────────────────────────────────────────
    {
        "type": "function",
        "function": {
            "name": "list_files",
            "description": "List files and directories inside the project.",
            "parameters": {
                "type": "object",
                "properties": {
                    "directory": {
                        "type": "string",
                        "description": "Relative path from project root (e.g. 'backend/python/app'). Default: root."
                    },
                    "pattern": {
                        "type": "string",
                        "description": "Glob-style filter (e.g. '*.py', '*.tsx'). Default: all."
                    }
                }
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "read_file",
            "description": "Read the contents of any file in the project.",
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "description": "Relative path from project root (e.g. 'backend/python/api/routes/agent_chat.py')"
                    },
                    "start_line": {
                        "type": "integer",
                        "description": "First line to read (1-indexed). Default: 1."
                    },
                    "end_line": {
                        "type": "integer",
                        "description": "Last line to read (inclusive). Default: first 200 lines."
                    }
                },
                "required": ["path"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "write_file",
            "description": (
                "Create or overwrite a file in the project. "
                "Backend .py files trigger uvicorn hot-reload automatically. "
                "Frontend .tsx/.ts files trigger Next.js HMR. "
                "Use this to add new features, agents, routes, or any code."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "description": "Relative path from project root"
                    },
                    "content": {
                        "type": "string",
                        "description": "Full file content to write"
                    },
                    "description": {
                        "type": "string",
                        "description": "Brief description of what this file does (for logs)"
                    }
                },
                "required": ["path", "content"]
            }
        }
    },

    # ── Terminal ──────────────────────────────────────────────────────────────
    {
        "type": "function",
        "function": {
            "name": "run_command",
            "description": (
                "Execute a shell command inside the project directory. "
                "Use for git operations, running scripts, reading logs, running tests, "
                "checking system state, or any shell operation."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "command": {"type": "string", "description": "Shell command to execute"},
                    "cwd": {
                        "type": "string",
                        "description": "Working directory relative to project root (e.g. 'backend/python'). Default: project root."
                    },
                    "timeout": {
                        "type": "integer",
                        "description": "Max seconds to wait (default 30, max 120)"
                    }
                },
                "required": ["command"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "install_package",
            "description": "Install a Python (pip) or Node.js (npm) package into the project.",
            "parameters": {
                "type": "object",
                "properties": {
                    "package_name": {
                        "type": "string",
                        "description": "Package name with optional version (e.g. 'requests', 'numpy==1.26', 'react-icons@latest')"
                    },
                    "package_type": {
                        "type": "string",
                        "enum": ["python", "npm"]
                    }
                },
                "required": ["package_name", "package_type"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "run_build_check",
            "description": (
                "Build or typecheck the current workspace and get back STRUCTURED errors "
                "(file, line, message) instead of raw text — use this instead of guessing a raw "
                "run_command build command, and use it after every file edit during a build to "
                "verify nothing broke before moving on."
            ),
            "parameters": {"type": "object", "properties": {}},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "run_tests",
            "description": (
                "Run the workspace's test suite (auto-detects npm test / vitest / jest / pytest) "
                "and get back a structured pass/fail summary instead of raw text."
            ),
            "parameters": {"type": "object", "properties": {}},
        },
    },

    # ── Web ───────────────────────────────────────────────────────────────────
    {
        "type": "function",
        "function": {
            "name": "web_search",
            "description": (
                "Search the internet for current information. "
                "Use to research technologies, check documentation, find answers, "
                "or look up anything VJ asks about."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "query":       {"type": "string", "description": "Search query"},
                    "num_results": {"type": "integer", "description": "Results to return (default 5, max 10)"}
                },
                "required": ["query"]
            }
        }
    },

    # ── Memory ────────────────────────────────────────────────────────────────
    {
        "type": "function",
        "function": {
            "name": "save_memory",
            "description": "Save a persistent note that survives across conversations.",
            "parameters": {
                "type": "object",
                "properties": {
                    "key":      {"type": "string", "description": "Short unique key (e.g. 'vj_prefers_concise')"},
                    "content":  {"type": "string"},
                    "category": {"type": "string", "enum": ["preference", "decision", "fact", "task", "observation"]}
                },
                "required": ["key", "content"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "recall_memory",
            "description": "Search or retrieve saved memories.",
            "parameters": {
                "type": "object",
                "properties": {
                    "key":      {"type": "string", "description": "Exact key to fetch"},
                    "category": {"type": "string", "description": "Filter by category"},
                    "search":   {"type": "string", "description": "Free-text search across content"}
                }
            }
        }
    },

    # ── Agent Messaging (Phase 8A) ────────────────────────────────────────────
    {
        "type": "function",
        "function": {
            "name": "send_agent_message",
            "description": (
                "Send an async message to another agent in the OS. "
                "The recipient will see it in their inbox the next time they are active. "
                "Use to coordinate tasks, pass information, or request action from a specialist agent."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "to_agent": {
                        "type": "string",
                        "description": "Codename of the recipient agent (e.g. 'scout', 'hermes', 'phantom')"
                    },
                    "subject": {
                        "type": "string",
                        "description": "Short subject line (e.g. 'New job lead', 'Research request', 'Follow up needed')"
                    },
                    "message": {
                        "type": "string",
                        "description": "Full message body. Be specific about what you need the other agent to do."
                    }
                },
                "required": ["to_agent", "subject", "message"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "read_messages",
            "description": (
                "Read messages in this agent's inbox — messages sent by other agents. "
                "Returns most recent first. Use to check for pending coordination tasks or information."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "limit": {
                        "type": "integer",
                        "description": "Number of messages to return (default 10, max 50)"
                    },
                    "unread_only": {
                        "type": "boolean",
                        "description": "If true, return only unread messages (default false)"
                    }
                }
            }
        }
    },

    # ── Autonomous Scheduling (Phase 8C) ──────────────────────────────────────
    {
        "type": "function",
        "function": {
            "name": "schedule_task",
            "description": (
                "Register a new recurring cron job that you own. "
                "The job will run automatically on the given schedule and call the specified worker. "
                "Use to set up your own proactive work — e.g. check emails every morning, "
                "monitor topics every 6 hours, generate daily reports."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "name": {
                        "type": "string",
                        "description": "Short unique name for this job (e.g. 'hermes-morning-check')"
                    },
                    "cron_expression": {
                        "type": "string",
                        "description": "5-part cron: 'minute hour day month day_of_week'. E.g. '0 8 * * *' = 8 AM UTC daily"
                    },
                    "worker_type": {
                        "type": "string",
                        "description": "Worker class to run. Options: EmailSyncWorker, GmailReplyMonitorWorker, HermesMonitorWorker, ScoutMonitorWorker, AtlasScheduledWorker, SageConsolidationWorker"
                    },
                    "description": {
                        "type": "string",
                        "description": "Human-readable description of what this job does and why you set it up"
                    },
                    "config": {
                        "type": "object",
                        "description": "Worker-specific config dict (can be empty {})"
                    }
                },
                "required": ["name", "cron_expression", "worker_type"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "cancel_task",
            "description": (
                "Cancel (delete) a cron job that you previously scheduled with schedule_task. "
                "Use the job name you gave it when creating it."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "name": {
                        "type": "string",
                        "description": "Exact name of the cron job to cancel"
                    }
                },
                "required": ["name"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "list_my_schedules",
            "description": "List all cron jobs you have registered with schedule_task.",
            "parameters": {
                "type": "object",
                "properties": {}
            }
        }
    },

    # ── Phase 9A — Shared memory (cross-agent knowledge) ──────────────────────
    {
        "type": "function",
        "function": {
            "name": "share_memory",
            "description": (
                "Write a piece of knowledge to the shared memory store visible to ALL agents. "
                "Use this to publish discoveries, research results, or coordination state "
                "that other agents should be able to read. "
                "Key must be unique — re-writing the same key updates the value."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "key": {
                        "type": "string",
                        "description": "Unique key identifying this memory (e.g. 'scout/company-X-contacts')"
                    },
                    "value": {
                        "type": "string",
                        "description": "The knowledge to store — text, JSON string, or any serialized format"
                    },
                    "tags": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "Optional tags for categorisation (e.g. ['research','linkedin','urgent'])"
                    }
                },
                "required": ["key", "value"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "recall_shared",
            "description": (
                "Read entries from the shared memory store that ALL agents can write to. "
                "Use to check what other agents have discovered or published. "
                "Filter by agent name, tag, or search text."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "search": {
                        "type": "string",
                        "description": "Text search across keys and values"
                    },
                    "agent": {
                        "type": "string",
                        "description": "Filter to memories written by a specific agent codename"
                    },
                    "tag": {
                        "type": "string",
                        "description": "Filter to memories with this tag"
                    },
                    "limit": {
                        "type": "integer",
                        "description": "Max results to return (default 20)"
                    }
                }
            }
        }
    },

    # ── Phase 9D — Persistent goals ───────────────────────────────────────────
    {
        "type": "function",
        "function": {
            "name": "set_goal",
            "description": (
                "Register a long-horizon goal for yourself. "
                "The scheduler checks all active goals daily and evaluates whether the condition "
                "is met — if so it marks the goal done and notifies you. "
                "Example: goal='Land a software engineer job', condition='I have an offer letter in my inbox'"
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "goal": {
                        "type": "string",
                        "description": "The goal to pursue (clear, concise statement)"
                    },
                    "condition": {
                        "type": "string",
                        "description": "Observable condition that means the goal is achieved"
                    }
                },
                "required": ["goal", "condition"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "list_goals",
            "description": "List all active goals registered for you or for a specific agent.",
            "parameters": {
                "type": "object",
                "properties": {
                    "status": {
                        "type": "string",
                        "enum": ["active", "completed", "cancelled", "all"],
                        "description": "Filter by goal status (default: active)"
                    }
                }
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "cancel_goal",
            "description": "Cancel an active goal by its ID (from list_goals).",
            "parameters": {
                "type": "object",
                "properties": {
                    "goal_id": {
                        "type": "string",
                        "description": "ID of the goal to cancel (UUID from list_goals)"
                    }
                },
                "required": ["goal_id"]
            }
        }
    },
]


# ── System prompt suffix injected for all agents ──────────────────────────────

TOOL_SYSTEM_SUFFIX = """

You have full tool access to read, modify, and extend Sir Jazper OS. Your capabilities:

INSPECTION:     list_agents · get_agent_info · list_departments
AGENTS:         create_agent · update_agent_settings · update_agent_status · delete_agent
DEPARTMENTS:    update_dept_settings
FILES:          list_files · read_file · write_file
TERMINAL:       run_command · install_package · run_build_check · run_tests
WEB:            web_search
MEMORY:         save_memory · recall_memory
SHARED MEMORY:  share_memory · recall_shared  (cross-agent knowledge store)
MESSAGING:      send_agent_message · read_messages
SCHEDULING:     schedule_task · cancel_task · list_my_schedules
GOALS:          set_goal · list_goals · cancel_goal

Key rules:
• Use read_file / list_files before modifying code — know what you're changing.
• Backend .py changes hot-reload automatically via uvicorn.
• Frontend .tsx/.ts changes hot-reload automatically via Next.js HMR.
• Use web_search when asked about current info or documentation.
• Use send_agent_message to delegate sub-tasks to specialist agents.
• Always confirm what you did after a successful action."""


# ── DB helper ─────────────────────────────────────────────────────────────────

def _db_conn():
    s = settings
    return psycopg2.connect(
        host=s.POSTGRES_HOST, port=s.POSTGRES_PORT,
        user=s.POSTGRES_USER, password=s.POSTGRES_PASSWORD, dbname=s.POSTGRES_DB,
    )


# ── Evolution log helper ───────────────────────────────────────────────────────

_MUTATION_TOOLS = {
    "create_agent", "delete_agent", "update_agent_settings", "update_agent_status",
    "update_dept_settings", "write_file", "run_command", "install_package",
    "save_memory",
}


def _log_evolution(
    agent_codename: str,
    action_type:    str,
    target:         str,
    description:    str,
    payload:        dict,
    outcome:        str = "success",
) -> None:
    """Fire-and-forget: append an entry to evolution_log after a mutation op."""
    try:
        conn = _db_conn()
        try:
            cur = conn.cursor()
            cur.execute(
                "INSERT INTO evolution_log "
                "(agent_codename, action_type, target, description, payload, outcome) "
                "VALUES (%s, %s, %s, %s, %s, %s)",
                (agent_codename, action_type, target[:500], description[:1000],
                 json.dumps(payload), outcome),
            )
            conn.commit()
            cur.close()
        finally:
            conn.close()
    except Exception:
        pass  # never block the caller on log failure


def _evolution_target(tool_name: str, args: dict) -> str:
    """Derive a human-readable target string from tool args."""
    if tool_name in ("create_agent", "delete_agent", "update_agent_settings", "update_agent_status"):
        return args.get("codename", "?")
    if tool_name == "update_dept_settings":
        return args.get("dept_id", "?")
    if tool_name in ("write_file", "read_file"):
        return args.get("path", "?")
    if tool_name == "run_command":
        return str(args.get("command", "?"))[:120]
    if tool_name == "install_package":
        return f"{args.get('package_type','pip')}:{args.get('package_name','?')}"
    if tool_name == "save_memory":
        return args.get("key", "?")
    return ""


# ── Result preview helper ─────────────────────────────────────────────────────

def _make_preview(tool_name: str, result_str: str) -> dict:
    """Return a concise preview dict to send to the frontend."""
    try:
        data = json.loads(result_str)
        if not isinstance(data, dict):
            return {"summary": str(data)[:200]}
        if "error" in data:
            return {"ok": False, "summary": f"Error: {data['error']}"}

        if tool_name == "read_file":
            lines = (data.get("content") or "").split("\n")
            return {"ok": True,
                    "summary": f"{data.get('path')} — {data.get('total_lines', '?')} lines",
                    "preview": "\n".join(lines[:8])}

        if tool_name == "write_file":
            return {"ok": True,
                    "summary": f"{data.get('action', 'wrote')} {data.get('path')} "
                               f"({data.get('lines', 0)} lines, {data.get('bytes', 0)} B)"}

        if tool_name == "list_files":
            items = data.get("items", [])
            names = [("📁 " if i["type"] == "dir" else "📄 ") + i["name"] for i in items[:10]]
            return {"ok": True,
                    "summary": f"{len(items)} items in {data.get('directory', '.')}",
                    "preview": "\n".join(names)}

        if tool_name == "run_command":
            output = (data.get("output") or "").strip()
            lines  = output.split("\n")[:6]
            ok     = data.get("exit_code", 1) == 0
            return {"ok": ok,
                    "summary": f"$ {data.get('command', '')[:60]}  [exit {data.get('exit_code', '?')}]",
                    "preview": "\n".join(lines)}

        if tool_name == "install_package":
            ok = data.get("ok", False)
            return {"ok": ok,
                    "summary": f"{'✓' if ok else '✗'} {data.get('type', 'pip')} install {data.get('package', '')}"}

        if tool_name == "create_agent":
            return {"ok": True, "summary": data.get("message", f"Agent '{data.get('codename')}' created")}

        if tool_name == "delete_agent":
            return {"ok": True, "summary": data.get("message", f"Agent '{data.get('codename')}' decommissioned")}

        if tool_name == "web_search":
            results  = data.get("results", [])
            snippets = [f"• {r.get('title', '')[:70]}" for r in results[:4]]
            return {"ok": True,
                    "summary": f"{len(results)} results for \"{data.get('query', '')}\"",
                    "preview": "\n".join(snippets)}

        if tool_name == "run_build_check":
            if data.get("ok"):
                return {"ok": True, "summary": f"Build clean — `{data.get('command')}` exited 0"}
            errs = data.get("errors", [])
            preview = "\n".join(f"{e.get('file', '')}:{e.get('line', '')} — {e.get('message', '')}" for e in errs[:10]) or data.get("raw_tail", "")[:400]
            return {"ok": False, "summary": f"{data.get('error_count', '?')} build error(s)", "preview": preview}

        if tool_name == "run_tests":
            if data.get("ok"):
                return {"ok": True, "summary": f"Tests passed — `{data.get('command')}`"}
            fails = data.get("failures", [])
            preview = "\n".join(f"FAILED {f.get('test', '')}" for f in fails[:10]) or data.get("raw_tail", "")[:400]
            return {"ok": False, "summary": f"{data.get('failure_count', '?')} test failure(s)", "preview": preview}

        if tool_name in ("save_memory",):
            return {"ok": True, "summary": f"Saved memory: {data.get('key')}"}

        if tool_name == "recall_memory":
            mems = data.get("memories", [])
            return {"ok": True,
                    "summary": f"{len(mems)} memories recalled",
                    "preview": "\n".join(f"[{m['key']}] {m['content'][:60]}" for m in mems[:4])}

        # Generic
        summary = data.get("message") or json.dumps(data)
        return {"ok": data.get("ok", True), "summary": str(summary)[:200]}

    except Exception:
        return {"summary": result_str[:200]}


# ── Main dispatcher ───────────────────────────────────────────────────────────

async def execute_tool(tool_name: str, args: dict, caller_codename: str) -> str:
    """Execute a tool call; return JSON string result."""
    try:
        dispatch = {
            "list_agents":           lambda: _list_agents(args.get("department"), args.get("status", "all")),
            "get_agent_info":        lambda: _get_agent_info(args["codename"]),
            "list_departments":      _list_departments,
            "create_agent":          lambda: _create_agent(args),
            "update_agent_settings": lambda: _update_agent_settings(args),
            "update_agent_status":   lambda: _update_agent_status(args["codename"], args["status"]),
            "delete_agent":          lambda: _delete_agent(args["codename"], args.get("reason", "")),
            "update_dept_settings":  lambda: _update_dept_settings(args),
            "list_files":            lambda: _list_files(args.get("directory", "."), args.get("pattern")),
            "read_file":             lambda: _read_file(args["path"], args.get("start_line", 1), args.get("end_line")),
            "write_file":            lambda: _write_file(args["path"], args["content"], args.get("description", "")),
            "run_command":           lambda: _run_command(args["command"], args.get("cwd"), min(int(args.get("timeout", 30)), 300)),
            "install_package":       lambda: _install_package(args["package_name"], args.get("package_type", "python")),
            "run_build_check":       lambda: _run_build_check(),
            "run_tests":             lambda: _run_tests(),
            "web_search":            lambda: _web_search(args["query"], min(int(args.get("num_results", 5)), 10)),
            "save_memory":           lambda: _save_memory(caller_codename, args["key"], args["content"], args.get("category", "observation")),
            "recall_memory":         lambda: _recall_memory(caller_codename, args.get("key"), args.get("category"), args.get("search")),
            # Phase 8A — messaging
            "send_agent_message":    lambda: _send_agent_message(caller_codename, args["to_agent"], args["subject"], args["message"]),
            "read_messages":         lambda: _read_messages(caller_codename, min(int(args.get("limit", 10)), 50), bool(args.get("unread_only", False))),
            # Phase 8C — scheduling
            "schedule_task":         lambda: _schedule_task(caller_codename, args["name"], args["cron_expression"], args["worker_type"], args.get("description", ""), args.get("config") or {}),
            "cancel_task":           lambda: _cancel_task(caller_codename, args["name"]),
            "list_my_schedules":     lambda: _list_my_schedules(caller_codename),
            # Phase 9A — shared memory
            "share_memory":          lambda: _share_memory(caller_codename, args["key"], args["value"], args.get("tags") or []),
            "recall_shared":         lambda: _recall_shared(args.get("search"), args.get("agent"), args.get("tag"), int(args.get("limit", 20))),
            # Phase 9D — persistent goals
            "set_goal":              lambda: _set_goal(caller_codename, args["goal"], args["condition"]),
            "list_goals":            lambda: _list_goals(caller_codename, args.get("status", "active")),
            "cancel_goal":           lambda: _cancel_goal(caller_codename, args["goal_id"]),
        }
        fn = dispatch.get(tool_name)
        if fn is None:
            return json.dumps({"error": f"Unknown tool: {tool_name}"})
        result = fn()

        # Log mutations to evolution_log (fire-and-forget, never raises)
        if tool_name in _MUTATION_TOOLS:
            try:
                r = json.loads(result)
                ok = not isinstance(r, dict) or "error" not in r
            except Exception:
                ok = True
            _log_evolution(
                agent_codename=caller_codename,
                action_type=tool_name,
                target=_evolution_target(tool_name, args),
                description=args.get("description", "") or "",
                payload={k: v for k, v in args.items() if k != "content"},  # omit large content
                outcome="success" if ok else "error",
            )

        return result
    except KeyError as e:
        return json.dumps({"error": f"Missing required argument: {e}"})
    except Exception as e:
        log.error("tool_execute_fail", tool=tool_name, caller=caller_codename, err=str(e))
        return json.dumps({"error": str(e)})


# ── Tool implementations ──────────────────────────────────────────────────────

def _list_agents(department: str | None, status: str) -> str:
    conn = _db_conn()
    try:
        cur = conn.cursor()
        where: list[str] = []
        params: list = []
        if department:
            where.append("LOWER(department) = LOWER(%s)"); params.append(department)
        if status and status != "all":
            where.append("status = %s"); params.append(status)
        sql = "SELECT codename, name, title, department, level, status, model FROM agent_registry"
        if where:
            sql += " WHERE " + " AND ".join(where)
        sql += " ORDER BY department, level, name"
        cur.execute(sql, params)
        rows = cur.fetchall()
        cur.close()
    finally:
        conn.close()
    return json.dumps([
        {"codename": r[0], "name": r[1], "title": r[2],
         "department": r[3], "level": r[4], "status": r[5], "model": r[6]}
        for r in rows
    ])


def _get_agent_info(codename: str) -> str:
    conn = _db_conn()
    try:
        cur = conn.cursor()
        cur.execute(
            "SELECT codename, name, title, department, level, status, model, "
            "       temperature, max_tokens, system_prompt_override, system_prompt, "
            "       voice_id, voice_prosody, description "
            "FROM agent_registry WHERE LOWER(codename) = LOWER(%s)",
            (codename,),
        )
        row = cur.fetchone()
        cur.close()
    finally:
        conn.close()
    if not row:
        return json.dumps({"error": f"Agent '{codename}' not found"})
    return json.dumps({
        "codename": row[0], "name": row[1], "title": row[2],
        "department": row[3], "level": row[4], "status": row[5], "model": row[6],
        "temperature": float(row[7]) if row[7] is not None else 0.5,
        "max_tokens": row[8],
        "system_prompt_override": row[9], "system_prompt": row[10],
        "voice_id": row[11], "voice_prosody": row[12] or {},
        "description": row[13],
    })


def _list_departments() -> str:
    conn = _db_conn()
    try:
        cur = conn.cursor()
        cur.execute(
            "SELECT d.id, d.name, d.description, d.enabled, d.head_agent, "
            "       COUNT(ar.codename) AS agent_count "
            "FROM departments d "
            "LEFT JOIN agent_registry ar ON LOWER(ar.department) = LOWER(d.id) "
            "GROUP BY d.id, d.name, d.description, d.enabled, d.head_agent "
            "ORDER BY d.name"
        )
        rows = cur.fetchall()
        cur.close()
    finally:
        conn.close()
    return json.dumps([
        {"id": r[0], "name": r[1], "description": r[2],
         "enabled": r[3], "head_agent_id": r[4], "agent_count": r[5]}
        for r in rows
    ])


def _create_agent(args: dict) -> str:
    codename = args["codename"].lower().strip()
    name     = args["name"].strip()
    dept     = args.get("department", "executive")
    title    = args.get("title", f"{name} Agent")
    level    = int(args.get("level", 3))
    prompt   = args.get("system_prompt", f"You are {name}, an AI agent in Sir Jazper OS.")
    model    = args.get("model", "llama-3.1-8b-instant")
    desc     = args.get("description", title)
    emoji    = args.get("emoji", "🤖")
    color    = args.get("badge_color", "#94a3b8")

    if not re.match(r'^[a-z][a-z0-9_]{1,29}$', codename):
        return json.dumps({"error": "Codename must be 2-30 lowercase alphanumeric chars (underscores OK)"})

    conn = _db_conn()
    try:
        cur = conn.cursor()
        cur.execute("SELECT 1 FROM agent_registry WHERE codename = %s", (codename,))
        if cur.fetchone():
            return json.dumps({"error": f"Codename '{codename}' already exists"})

        cur.execute(
            "SELECT COALESCE(MAX(CAST(SUBSTRING(agent_id FROM 5) AS INTEGER)), 0) "
            "FROM agent_registry WHERE agent_id ~ '^AGT-[0-9]+$'"
        )
        max_n  = cur.fetchone()[0]
        new_id = f"AGT-{max_n + 1:04d}"

        cur.execute(
            """INSERT INTO agent_registry
               (agent_id, codename, name, version, status, department, title,
                level, model, temperature, max_tokens, system_prompt,
                description, avatar_emoji, badge_color)
               VALUES (%s,%s,%s,'1.0.0','active',%s,%s,%s,%s,0.6,1000,%s,%s,%s,%s)""",
            (new_id, codename, name, dept, title, level, model, prompt, desc, emoji, color),
        )
        conn.commit()
        cur.close()
    finally:
        conn.close()

    return json.dumps({
        "ok": True,
        "agent_id": new_id,
        "codename": codename,
        "name": name,
        "department": dept,
        "title": title,
        "model": model,
        "message": (
            f"Agent '{name}' ({codename}) created with ID {new_id}. "
            f"Now active in the {dept} department — available for direct chat immediately."
        ),
    })


def _update_agent_settings(args: dict) -> str:
    codename = args["codename"]
    fields:  list[str] = []
    values:  list      = []

    if "system_prompt_override" in args:
        fields.append("system_prompt_override = %s")
        values.append(args["system_prompt_override"] or None)
    if "model" in args:
        fields.append("model = %s"); values.append(args["model"])
    if "temperature" in args:
        fields.append("temperature = %s")
        values.append(max(0.0, min(2.0, float(args["temperature"]))))
    if "max_tokens" in args:
        fields.append("max_tokens = %s")
        values.append(max(128, min(8192, int(args["max_tokens"]))))
    if "voice_prosody" in args:
        fields.append("voice_prosody = %s")
        values.append(json.dumps(args["voice_prosody"]))

    if not fields:
        return json.dumps({"ok": True, "message": "No fields provided — nothing changed."})

    fields.append("updated_at = NOW()")
    values.append(codename)
    conn = _db_conn()
    try:
        cur = conn.cursor()
        cur.execute(
            f"UPDATE agent_registry SET {', '.join(fields)} WHERE LOWER(codename) = LOWER(%s)",
            values,
        )
        updated = cur.rowcount
        conn.commit()
        cur.close()
    finally:
        conn.close()
    if updated == 0:
        return json.dumps({"error": f"Agent '{codename}' not found"})
    changed = [f.split(" =")[0] for f in fields[:-1]]
    return json.dumps({"ok": True, "codename": codename, "fields_changed": changed,
                       "message": f"Updated {codename}: {', '.join(changed)}"})


def _update_agent_status(codename: str, status: str) -> str:
    conn = _db_conn()
    try:
        cur = conn.cursor()
        cur.execute(
            "UPDATE agent_registry SET status = %s, updated_at = NOW() "
            "WHERE LOWER(codename) = LOWER(%s)",
            (status, codename),
        )
        updated = cur.rowcount
        conn.commit()
        cur.close()
    finally:
        conn.close()
    if updated == 0:
        return json.dumps({"error": f"Agent '{codename}' not found"})
    return json.dumps({"ok": True, "codename": codename, "new_status": status,
                       "message": f"{codename} is now {status}"})


def _delete_agent(codename: str, reason: str) -> str:
    if codename.lower() == "jazper":
        return json.dumps({"error": "Cannot decommission Jazper — he is the core OS."})
    conn = _db_conn()
    try:
        cur = conn.cursor()
        cur.execute(
            "UPDATE agent_registry SET status = 'terminated', updated_at = NOW() "
            "WHERE LOWER(codename) = LOWER(%s) AND status != 'terminated'",
            (codename,),
        )
        updated = cur.rowcount
        conn.commit()
        cur.close()
    finally:
        conn.close()
    if updated == 0:
        return json.dumps({"error": f"Agent '{codename}' not found or already terminated"})
    return json.dumps({"ok": True, "codename": codename, "status": "terminated",
                       "message": f"Agent '{codename}' decommissioned. Reason: {reason or 'unspecified'}"})


def _update_dept_settings(args: dict) -> str:
    dept_id = args["dept_id"]
    fields:  list[str] = []
    values:  list      = []
    if "name" in args:
        fields.append("name = %s"); values.append(args["name"])
    if "description" in args:
        fields.append("description = %s"); values.append(args["description"])
    if "enabled" in args:
        fields.append("enabled = %s"); values.append(bool(args["enabled"]))
    if not fields:
        return json.dumps({"ok": True, "message": "No fields provided."})
    values.append(dept_id)
    conn = _db_conn()
    try:
        cur = conn.cursor()
        cur.execute(f"UPDATE departments SET {', '.join(fields)} WHERE id = %s", values)
        updated = cur.rowcount
        conn.commit()
        cur.close()
    finally:
        conn.close()
    if updated == 0:
        return json.dumps({"error": f"Department '{dept_id}' not found"})
    return json.dumps({"ok": True, "dept_id": dept_id,
                       "fields_changed": [f.split(" =")[0] for f in fields]})


# ── File system tools ─────────────────────────────────────────────────────────

def _resolve_safe(path_str: str) -> "Path | None":
    """Resolve a path relative to the active IDE workspace; return None if it escapes the root."""
    root   = _workspace_root()
    target = (root / path_str).resolve()
    if not str(target).startswith(str(root)):
        return None
    return target


def _list_files(directory: str = ".", pattern: "str | None" = None) -> str:
    target = _resolve_safe(directory)
    if target is None:
        return json.dumps({"error": "Directory must be within the project root"})
    if not target.exists():
        return json.dumps({"error": f"Directory not found: {directory}"})
    if not target.is_dir():
        return json.dumps({"error": f"Not a directory: {directory}"})
    try:
        import fnmatch
        all_items = sorted(target.iterdir(), key=lambda x: (x.is_file(), x.name.lower()))
        if pattern:
            all_items = [f for f in all_items if fnmatch.fnmatch(f.name, pattern)]
        items = []
        for item in all_items[:60]:
            items.append({
                "name": item.name,
                "type": "file" if item.is_file() else "dir",
                "size": item.stat().st_size if item.is_file() else None,
            })
        return json.dumps({
            "directory": directory,
            "items": items,
            "total": len(items),
            "truncated": len(items) == 60,
        })
    except Exception as e:
        return json.dumps({"error": str(e)})


def _read_file(path: str, start_line: int = 1, end_line: "int | None" = None) -> str:
    target = _resolve_safe(path)
    if target is None:
        return json.dumps({"error": "File must be within the project root"})
    if not target.exists():
        return json.dumps({"error": f"File not found: {path}"})
    if not target.is_file():
        return json.dumps({"error": f"Not a file: {path}"})
    try:
        content = target.read_text(encoding="utf-8", errors="replace")
        lines   = content.split("\n")
        total   = len(lines)
        start   = max(0, start_line - 1)
        end     = end_line if end_line else min(total, start + 200)
        end     = min(end, total)
        return json.dumps({
            "path":        path,
            "content":     "\n".join(lines[start:end]),
            "total_lines": total,
            "shown_lines": f"{start + 1}–{end}",
            "truncated":   end < total,
        })
    except Exception as e:
        return json.dumps({"error": str(e)})


def _write_file(path: str, content: str, description: str = "") -> str:
    target = _resolve_safe(path)
    if target is None:
        return json.dumps({"error": "File must be within the project root"})
    if target.name in (".env", ".env.local", ".env.production"):
        return json.dumps({"error": "Cannot write to .env files"})
    try:
        existed = target.exists()
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(content, encoding="utf-8")
        log.info("agent_wrote_file", path=path, action="updated" if existed else "created",
                 description=description)
        return json.dumps({
            "ok":          True,
            "path":        path,
            "action":      "updated" if existed else "created",
            "bytes":       len(content.encode("utf-8")),
            "lines":       len(content.split("\n")),
            "description": description,
        })
    except Exception as e:
        return json.dumps({"error": str(e)})


# ── Terminal tools ────────────────────────────────────────────────────────────

# Commands that serve forever and never exit on their own — dev servers, watchers.
# Waiting on these with subprocess.run() just blocks until the timeout, then reports
# a false failure. Launch them detached instead and tell the agent it's running.
_LONG_RUNNING_PATTERNS = [
    r"\bhttp\.server\b", r"\brunserver\b", r"\bnpm\s+run\s+dev\b", r"\bnpm\s+start\b",
    r"\byarn\s+dev\b", r"\byarn\s+start\b", r"\bvite\b(?!\s+build)", r"\bnext\s+dev\b",
    r"\buvicorn\b.*(--reload|\brun\b)", r"\bflask\s+run\b", r"\bng\s+serve\b",
    r"\blive-server\b", r"\bpython\s+-m\s+http\.server\b", r"\bnodemon\b",
]


def _is_long_running(command: str) -> bool:
    cmd_lower = command.lower()
    return any(re.search(p, cmd_lower) for p in _LONG_RUNNING_PATTERNS)


def _run_command(command: str, cwd: "str | None" = None, timeout: int = 30) -> str:
    cmd_lower = command.lower()
    for pattern in _BLOCKED_PATTERNS:
        if re.search(pattern, cmd_lower):
            return json.dumps({"error": "Command blocked for safety."})

    root     = _workspace_root()
    work_dir = root
    if cwd:
        resolved = _resolve_safe(cwd)
        if resolved is None:
            return json.dumps({
                "error": f"cwd must be inside the current workspace ({root}). Omit cwd to run "
                         f"from the workspace root, or pass a path relative to it.",
            })
        work_dir = resolved

    if _is_long_running(command):
        try:
            proc = subprocess.Popen(
                command, shell=True, cwd=str(work_dir),
                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
            )
            return json.dumps({
                "ok": True,
                "started_background": True,
                "pid": proc.pid,
                "command": command,
                "cwd": str(work_dir),
                "message": (
                    f"'{command}' looks like a long-running server, so it was started in the "
                    f"background (PID {proc.pid}) instead of waiting for it to exit — it never "
                    f"would have. It's running now; do not try to run it again or wait for output. "
                    f"Tell the user it's running and where (usually http://localhost:<port>)."
                ),
            })
        except Exception as e:
            return json.dumps({"error": str(e), "command": command})

    try:
        result = subprocess.run(
            command,
            shell=True,
            capture_output=True,
            text=True,
            cwd=str(work_dir),
            timeout=timeout,
        )
        stdout = result.stdout or ""
        stderr = result.stderr or ""
        if len(stdout) > 4000:
            stdout = stdout[:4000] + "\n... [truncated]"
        return json.dumps({
            "command":   command,
            "exit_code": result.returncode,
            "output":    stdout,
            "stderr":    stderr[:500] if stderr else "",
            "cwd":       str(work_dir),
        })
    except subprocess.TimeoutExpired:
        return json.dumps({"error": f"Timed out after {timeout}s", "command": command})
    except Exception as e:
        return json.dumps({"error": str(e), "command": command})


# ── Structured build/test tools ──────────────────────────────────────────────

_TSC_ERROR_RE   = re.compile(r'^(?P<file>.+?)\((?P<line>\d+),(?P<col>\d+)\):\s*error\s+(?P<msg>.+)$')
_ESLINT_ERROR_RE = re.compile(r'^\s*(?P<line>\d+):(?P<col>\d+)\s+error\s+(?P<msg>.+)$')
_PYTEST_FAIL_RE  = re.compile(r'^FAILED\s+(?P<test>\S+)(?:\s+-\s+(?P<msg>.+))?$')
_PY_TRACE_RE     = re.compile(r'^\s*File "(?P<file>.+?)", line (?P<line>\d+)')


def _parse_build_errors(output: str) -> list[dict]:
    errors = []
    for line in output.splitlines():
        m = _TSC_ERROR_RE.match(line.strip())
        if m:
            errors.append({"file": m["file"], "line": int(m["line"]), "message": m["msg"]})
            continue
        m = _ESLINT_ERROR_RE.match(line)
        if m:
            errors.append({"file": "", "line": int(m["line"]), "message": m["msg"]})
    return errors[:50]


def _run_build_check() -> str:
    root = _workspace_root()
    has_pkg    = (root / "package.json").exists()
    has_tscfg  = (root / "tsconfig.json").exists()
    has_pyproj = (root / "requirements.txt").exists() or (root / "pyproject.toml").exists()

    if has_pkg:
        cmd = "npm run build" if _npm_has_script(root, "build") else (
            "npx tsc --noEmit" if has_tscfg else "npm run build"
        )
    elif has_pyproj:
        cmd = "python -m py_compile $(git ls-files '*.py')" if (root / ".git").exists() else "python -m compileall -q ."
    else:
        return json.dumps({"error": "No package.json or Python project found in this workspace — nothing to build-check."})

    try:
        result = subprocess.run(cmd, shell=True, capture_output=True, text=True, cwd=str(root), timeout=180)
    except subprocess.TimeoutExpired:
        return json.dumps({"error": "Build check timed out after 180s", "command": cmd})
    except Exception as e:
        return json.dumps({"error": str(e), "command": cmd})

    output = (result.stdout or "") + "\n" + (result.stderr or "")
    errors = _parse_build_errors(output)
    return json.dumps({
        "ok": result.returncode == 0,
        "command": cmd,
        "exit_code": result.returncode,
        "error_count": len(errors),
        "errors": errors,
        "raw_tail": output[-1500:] if not errors else "",
    })


def _npm_has_script(root: Path, script: str) -> bool:
    try:
        pkg = json.loads((root / "package.json").read_text(encoding="utf-8"))
        return script in (pkg.get("scripts") or {})
    except Exception:
        return False


def _run_tests() -> str:
    root = _workspace_root()
    has_pkg = (root / "package.json").exists()
    has_py_tests = (root / "pytest.ini").exists() or (root / "requirements.txt").exists() or any(root.glob("**/test_*.py"))

    if has_pkg and _npm_has_script(root, "test"):
        cmd = "npm test -- --run" if _npm_has_script(root, "test") else "npm test"
    elif has_py_tests:
        cmd = "python -m pytest -q"
    else:
        return json.dumps({"error": "No test setup found (no npm test script, no pytest project) in this workspace."})

    try:
        result = subprocess.run(cmd, shell=True, capture_output=True, text=True, cwd=str(root), timeout=180)
    except subprocess.TimeoutExpired:
        return json.dumps({"error": "Tests timed out after 180s", "command": cmd})
    except Exception as e:
        return json.dumps({"error": str(e), "command": cmd})

    output = (result.stdout or "") + "\n" + (result.stderr or "")
    failures = [m.groupdict() for line in output.splitlines() if (m := _PYTEST_FAIL_RE.match(line.strip()))]
    return json.dumps({
        "ok": result.returncode == 0,
        "command": cmd,
        "exit_code": result.returncode,
        "failure_count": len(failures),
        "failures": failures,
        "raw_tail": output[-1500:],
    })


def _install_package(package_name: str, package_type: str) -> str:
    if not re.match(r'^[a-zA-Z0-9_\-\.\[\]>=<,!~\s@]+$', package_name):
        return json.dumps({"error": "Invalid package name"})

    if package_type == "python":
        cmd = [sys.executable, "-m", "pip", "install", package_name]
        cwd = str(PROJECT_ROOT / "backend" / "python")
    elif package_type == "npm":
        cmd = ["npm", "install", "--save", package_name]
        cwd = str(PROJECT_ROOT / "frontend")
    else:
        return json.dumps({"error": f"Unknown type '{package_type}'. Use 'python' or 'npm'."})

    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=180, cwd=cwd)
        output = (result.stdout or "") + (result.stderr or "")
        tail   = output[-1500:] if len(output) > 1500 else output
        return json.dumps({
            "ok":        result.returncode == 0,
            "package":   package_name,
            "type":      package_type,
            "exit_code": result.returncode,
            "output":    tail,
        })
    except subprocess.TimeoutExpired:
        return json.dumps({"error": "Installation timed out (>180s)"})
    except Exception as e:
        return json.dumps({"error": str(e)})


# ── Web search ────────────────────────────────────────────────────────────────

def _web_search(query: str, num_results: int = 5) -> str:
    try:
        try:
            from ddgs import DDGS
        except ImportError:
            from duckduckgo_search import DDGS
        with DDGS() as ddgs:
            raw = list(ddgs.text(query, max_results=num_results))
        return json.dumps({
            "query": query,
            "results": [
                {"title": r.get("title", ""), "snippet": r.get("body", ""), "url": r.get("href", "")}
                for r in raw
            ],
        })
    except Exception:
        # Fallback: DDG Instant Answer API
        try:
            import requests as _req, urllib.parse
            encoded = urllib.parse.quote_plus(query)
            r    = _req.get(
                f"https://api.duckduckgo.com/?q={encoded}&format=json&no_redirect=1&no_html=1",
                timeout=10, headers={"User-Agent": "SirJazperOS/1.0"},
            )
            data    = r.json()
            results = []
            if data.get("Abstract"):
                results.append({
                    "title":   data.get("Heading", query),
                    "snippet": data["Abstract"],
                    "url":     data.get("AbstractURL", ""),
                })
            for topic in data.get("RelatedTopics", [])[:num_results]:
                if isinstance(topic, dict) and "Text" in topic:
                    results.append({
                        "title":   topic["Text"][:80],
                        "snippet": topic["Text"],
                        "url":     topic.get("FirstURL", ""),
                    })
            if not results:
                return json.dumps({"query": query, "results": [], "message": "No results found."})
            return json.dumps({"query": query, "results": results[:num_results]})
        except Exception as e2:
            return json.dumps({"error": str(e2), "query": query})


# ── Memory tools ──────────────────────────────────────────────────────────────

def _save_memory(caller: str, key: str, content: str, category: str) -> str:
    conn = _db_conn()
    try:
        cur = conn.cursor()
        cur.execute(
            """INSERT INTO agent_memory (agent_codename, key, content, category, updated_at)
               VALUES (LOWER(%s), %s, %s, %s, NOW())
               ON CONFLICT (agent_codename, key) DO UPDATE
               SET content = EXCLUDED.content, category = EXCLUDED.category, updated_at = NOW()""",
            (caller, key, content, category),
        )
        conn.commit()
        cur.close()
    finally:
        conn.close()
    return json.dumps({"ok": True, "key": key, "category": category})


def _recall_memory(caller: str, key: "str | None", category: "str | None", search: "str | None") -> str:
    conn = _db_conn()
    try:
        cur = conn.cursor()
        conditions = ["LOWER(agent_codename) = LOWER(%s)"]
        params: list = [caller]
        if key:
            conditions.append("key = %s");         params.append(key)
        if category:
            conditions.append("category = %s");    params.append(category)
        if search:
            conditions.append("content ILIKE %s"); params.append(f"%{search}%")
        cur.execute(
            f"SELECT key, content, category, updated_at FROM agent_memory "
            f"WHERE {' AND '.join(conditions)} ORDER BY updated_at DESC LIMIT 30",
            params,
        )
        rows = cur.fetchall()
        cur.close()
    finally:
        conn.close()
    if not rows:
        return json.dumps({"memories": [], "message": "No memories found."})
    return json.dumps({
        "memories": [
            {"key": r[0], "content": r[1], "category": r[2],
             "updated_at": r[3].isoformat() if r[3] else None}
            for r in rows
        ]
    })


# ── Phase 8A — Agent messaging tools ─────────────────────────────────────────

def _send_agent_message(caller: str, to_agent: str, subject: str, message: str) -> str:
    """Send a message to another agent via agent_bus + persist to agent_communications."""
    # Verify the recipient exists
    conn = _db_conn()
    try:
        cur = conn.cursor()
        cur.execute(
            "SELECT codename, name FROM agent_registry WHERE LOWER(codename) = LOWER(%s)",
            (to_agent,),
        )
        row = cur.fetchone()
        cur.close()
    finally:
        conn.close()

    if not row:
        return json.dumps({"error": f"Agent '{to_agent}' not found in registry"})

    recipient_codename, recipient_name = row

    # Persist to DB directly (synchronous — already in thread executor context)
    conn2 = _db_conn()
    try:
        cur2 = conn2.cursor()
        cur2.execute(
            """INSERT INTO agent_communications (from_agent, to_agent, subject, payload, status)
               VALUES (%s, %s, %s, %s::jsonb, 'sent')""",
            (caller, recipient_codename, subject[:500], json.dumps({"message": message})),
        )
        conn2.commit()
        cur2.close()
    finally:
        conn2.close()

    log.info("AgentTool: message sent", from_=caller, to=recipient_codename, subject=subject)
    return json.dumps({
        "ok":        True,
        "to":        recipient_codename,
        "to_name":   recipient_name,
        "subject":   subject,
        "message":   f"Message delivered to {recipient_name}'s inbox.",
    })


def _read_messages(caller: str, limit: int = 10, unread_only: bool = False) -> str:
    """Return messages in this agent's inbox (sent to them by other agents)."""
    conn = _db_conn()
    try:
        cur = conn.cursor()
        conditions = ["LOWER(to_agent) = LOWER(%s)"]
        params: list = [caller]
        if unread_only:
            conditions.append("status = 'sent'")
        cur.execute(
            f"""SELECT id, from_agent, subject, payload, status, created_at
                FROM agent_communications
                WHERE {' AND '.join(conditions)}
                ORDER BY created_at DESC
                LIMIT %s""",
            params + [limit],
        )
        rows = cur.fetchall()
        cur.close()
    finally:
        conn.close()

    messages = []
    for r in rows:
        payload = r[3] or {}
        messages.append({
            "id":         str(r[0]),
            "from":       r[1],
            "subject":    r[2],
            "message":    payload.get("message", ""),
            "status":     r[4],
            "received_at": r[5].isoformat() if r[5] else None,
        })

    if not messages:
        return json.dumps({"messages": [], "message": "No messages in inbox."})
    return json.dumps({"messages": messages, "count": len(messages)})


# ── Phase 8C — Autonomous scheduling tools ────────────────────────────────────

_VALID_WORKERS = {
    "EmailSyncWorker", "GmailReplyMonitorWorker", "HermesMonitorWorker",
    "ScoutMonitorWorker", "AtlasScheduledWorker", "SageConsolidationWorker",
    "JobApplyWorker",
}


def _schedule_task(
    caller: str, name: str, cron_expression: str,
    worker_type: str, description: str, config: dict,
) -> str:
    """Insert a cron job owned by this agent, then sync the scheduler."""
    parts = cron_expression.strip().split()
    if len(parts) != 5:
        return json.dumps({"error": "cron_expression must have exactly 5 parts: 'min hour day month dow'"})

    if worker_type not in _VALID_WORKERS:
        return json.dumps({
            "error": f"Unknown worker_type '{worker_type}'. Valid: {', '.join(sorted(_VALID_WORKERS))}"
        })

    conn = _db_conn()
    try:
        cur = conn.cursor()
        # Prevent duplicate names per agent
        cur.execute(
            "SELECT id FROM cron_jobs WHERE LOWER(name) = LOWER(%s) AND LOWER(owner_agent) = LOWER(%s)",
            (name, caller),
        )
        if cur.fetchone():
            cur.close()
            return json.dumps({"error": f"You already have a job named '{name}'. Cancel it first."})

        cur.execute(
            """INSERT INTO cron_jobs (name, worker_type, schedule, enabled, config, owner_agent, description)
               VALUES (%s, %s, %s, TRUE, %s::jsonb, %s, %s)
               RETURNING id""",
            (name, worker_type, cron_expression, json.dumps(config), caller, description[:500]),
        )
        job_id = str(cur.fetchone()[0])
        conn.commit()
        cur.close()
    finally:
        conn.close()

    # Hot-sync the APScheduler instance
    try:
        from core.scheduler.scheduler import sync_jobs
        sync_jobs()
    except Exception as exc:
        log.warning("schedule_task: sync_jobs failed (non-fatal)", error=str(exc))

    log.info("AgentTool: task scheduled", agent=caller, job=name, cron=cron_expression)
    return json.dumps({
        "ok":       True,
        "job_id":   job_id,
        "name":     name,
        "schedule": cron_expression,
        "worker":   worker_type,
        "message":  f"Job '{name}' scheduled ({cron_expression}). It will run automatically.",
    })


def _cancel_task(caller: str, name: str) -> str:
    """Delete a cron job owned by this agent, then sync the scheduler."""
    conn = _db_conn()
    try:
        cur = conn.cursor()
        cur.execute(
            "DELETE FROM cron_jobs WHERE LOWER(name) = LOWER(%s) AND LOWER(owner_agent) = LOWER(%s) RETURNING id",
            (name, caller),
        )
        deleted = cur.fetchone()
        conn.commit()
        cur.close()
    finally:
        conn.close()

    if not deleted:
        return json.dumps({"error": f"No job named '{name}' found that belongs to you."})

    try:
        from core.scheduler.scheduler import sync_jobs
        sync_jobs()
    except Exception as exc:
        log.warning("cancel_task: sync_jobs failed (non-fatal)", error=str(exc))

    log.info("AgentTool: task cancelled", agent=caller, job=name)
    return json.dumps({"ok": True, "cancelled": name, "message": f"Job '{name}' has been removed."})


def _list_my_schedules(caller: str) -> str:
    """List all cron jobs owned by this agent."""
    conn = _db_conn()
    try:
        cur = conn.cursor()
        cur.execute(
            """SELECT id, name, worker_type, schedule, enabled, description, created_at
               FROM cron_jobs WHERE LOWER(owner_agent) = LOWER(%s)
               ORDER BY created_at DESC""",
            (caller,),
        )
        rows = cur.fetchall()
        cur.close()
    finally:
        conn.close()

    if not rows:
        return json.dumps({"schedules": [], "message": "You have no registered schedules."})
    return json.dumps({
        "schedules": [
            {
                "id":          str(r[0]),
                "name":        r[1],
                "worker_type": r[2],
                "schedule":    r[3],
                "enabled":     r[4],
                "description": r[5] or "",
                "created_at":  r[6].isoformat() if r[6] else None,
            }
            for r in rows
        ],
        "count": len(rows),
    })


# ── Phase 9A — Shared memory tools ───────────────────────────────────────────

def _share_memory(caller: str, key: str, value: str, tags: list) -> str:
    conn = _db_conn()
    try:
        cur = conn.cursor()
        cur.execute("""
            INSERT INTO shared_memory (key, value, writing_agent, tags)
            VALUES (%s, %s, %s, %s)
            ON CONFLICT (key) DO UPDATE
              SET value = EXCLUDED.value,
                  writing_agent = EXCLUDED.writing_agent,
                  tags = EXCLUDED.tags,
                  updated_at = NOW()
            RETURNING id
        """, (key, value, caller, tags or []))
        row_id = cur.fetchone()[0]
        conn.commit()
        cur.close()
    finally:
        conn.close()
    log.info("AgentTool: shared memory written", agent=caller, key=key)
    return json.dumps({"ok": True, "key": key, "id": str(row_id),
                       "message": f"Shared memory '{key}' written — visible to all agents."})


def _recall_shared(search: "str | None", agent: "str | None", tag: "str | None", limit: int = 20) -> str:
    conn = _db_conn()
    try:
        cur = conn.cursor()
        clauses, params = [], []
        if agent:
            clauses.append("writing_agent = %s"); params.append(agent)
        if tag:
            clauses.append("%s = ANY(tags)"); params.append(tag)
        if search:
            clauses.append("(key ILIKE %s OR value ILIKE %s)")
            params += [f"%{search}%", f"%{search}%"]
        where = ("WHERE " + " AND ".join(clauses)) if clauses else ""
        cur.execute(
            f"""SELECT key, value, writing_agent, tags, updated_at
               FROM shared_memory {where}
               ORDER BY updated_at DESC LIMIT %s""",
            params + [min(limit, 50)],
        )
        rows = cur.fetchall()
        cur.close()
    finally:
        conn.close()
    if not rows:
        return json.dumps({"memories": [], "message": "No shared memories found."})
    return json.dumps({
        "memories": [
            {"key": r[0], "value": r[1], "written_by": r[2],
             "tags": r[3], "updated_at": r[4].isoformat() if r[4] else None}
            for r in rows
        ],
        "count": len(rows),
    })


# ── Phase 9D — Persistent goal tools ─────────────────────────────────────────

def _set_goal(caller: str, goal: str, condition: str) -> str:
    conn = _db_conn()
    try:
        cur = conn.cursor()
        cur.execute("""
            INSERT INTO agent_goals (agent_codename, goal, condition, status)
            VALUES (%s, %s, %s, 'active')
            RETURNING id
        """, (caller, goal[:500], condition[:500]))
        goal_id = str(cur.fetchone()[0])
        conn.commit()
        cur.close()
    finally:
        conn.close()
    log.info("AgentTool: goal set", agent=caller, goal=goal[:80])
    return json.dumps({
        "ok": True, "goal_id": goal_id,
        "message": f"Goal registered. The scheduler will check daily whether the condition is met.",
    })


def _list_goals(caller: str, status: str = "active") -> str:
    conn = _db_conn()
    try:
        cur = conn.cursor()
        where = "WHERE agent_codename = %s"
        params: list = [caller]
        if status and status != "all":
            where += " AND status = %s"; params.append(status)
        cur.execute(
            f"""SELECT id, goal, condition, status, last_triggered, trigger_count, created_at
               FROM agent_goals {where} ORDER BY created_at DESC""",
            params,
        )
        rows = cur.fetchall()
        cur.close()
    finally:
        conn.close()
    return json.dumps({
        "goals": [
            {"id": str(r[0]), "goal": r[1], "condition": r[2], "status": r[3],
             "last_triggered": r[4].isoformat() if r[4] else None,
             "trigger_count": r[5],
             "created_at": r[6].isoformat() if r[6] else None}
            for r in rows
        ],
        "count": len(rows),
    })


def _cancel_goal(caller: str, goal_id: str) -> str:
    conn = _db_conn()
    try:
        cur = conn.cursor()
        cur.execute("""
            UPDATE agent_goals SET status = 'cancelled'
            WHERE id = %s AND agent_codename = %s AND status = 'active'
            RETURNING id
        """, (goal_id, caller))
        row = cur.fetchone()
        conn.commit()
        cur.close()
    finally:
        conn.close()
    if not row:
        return json.dumps({"error": f"Goal '{goal_id}' not found or not yours to cancel."})
    return json.dumps({"ok": True, "goal_id": goal_id, "message": "Goal cancelled."})
