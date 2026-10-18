# Sir Jazper OS — Future Upgrades

This file tracks features that are designed but not yet implemented.
See [status.md](status.md) for what's in progress now.

---

## IT Department — Self-Repair & Self-Create (Phase 5) ✅ BUILT

Full design in [architecture/agents.md](../architecture/agents.md#phase-5).

### What it is

Two distinct capabilities that together make Sir Jazper partially self-maintaining:

**Self-Repair:** Jazper detects something is broken at runtime, diagnoses the root cause, applies a targeted fix, verifies it, and notifies you. You don't have to intervene.

**Self-Create:** You describe a new feature in natural language. Jazper writes the code for a new agent or tool, tests it, integrates it into the registry, and deploys it — all without manual coding.

### The IT Department team

| Agent | Role | Model |
|-------|------|-------|
| Darwin | Engineering Manager — routes repair/create tasks | llama-3.3-70b |
| Oracle | Diagnostician — reads logs + source, finds root cause | llama-3.3-70b |
| Forge | Developer — writes code fixes and new agent files | llama-3.3-70b |
| Aria | QA Head — coordinates Verdict, Probe, Pulse gate pipeline | llama-3.3-70b |
| Verdict | Static diff reviewer — blocks CRITICAL issues before apply | llama-3.1-8b |
| Probe | Post-apply test runner — full pytest suite | rule-based |
| Pulse | Endpoint smoke tester — live health checks every 15 min | rule-based |
| Shield | Emergency test runner — stop-on-first for Darwin loops | rule-based |
| Scroll | Documentation — updates docs on code changes | llama-3.1-8b |
| Sentry | Monitor — rule-based watcher, wakes Darwin on errors | Rule-based |

---

## Personality Timeline (Phase 6)

Simulate you at any specific year — not just preset phases, but any point in your life — based on memories stored in Sage.

```
"Show me how I would have thought about this in 2019"
→ Sage retrieves memories tagged 2019
→ System prompt constructed from those memories
→ 2019-you responds
```

---

## Digital Twin

The end-state of Phases. An AI model that has absorbed enough of your memories, decisions, writing style, and preferences to simulate how you would respond to something — not as a philosophical exercise, but as a practical tool.

Use cases:
- Draft emails in your voice while you sleep
- Answer questions on your behalf in contexts you've pre-approved
- Simulate how you'd react to a life scenario before committing

Requires: extensive memory history, fine-tuning or long-context prompting, and a strong ethical framework around consent and identity.

---

## Voice-First Mode

Full offline voice pipeline that replaces the keyboard entirely:

```
Microphone → Silero VAD → Faster-Whisper → Intent → Agent Router → LLM → Edge-TTS → Speaker
```

Currently: Faster-Whisper STT and Edge-TTS TTS are implemented.
Missing: Silero VAD (voice activity detection), wake word, always-on microphone loop.

---

## Desktop App (Tauri)

Wrap the Next.js frontend in Tauri for a native desktop experience:
- System tray integration
- Global keyboard shortcut to open Jazper
- File system access (read/write local files directly)
- Desktop notifications (not browser notifications)
- Offline-first: all services run locally, no browser needed

Currently: web-only. Tauri wrapper is straightforward once the web app is stable.

---

## Local Model Fallback

When Groq rate limits are hit, automatically fall back to LM Studio local models:

```
Groq rate limit hit → detect error → retry with LM Studio
Sage + Scout → drop to 3B local model (fast)
Hermes + Atlas → stay on Groq (quality matters for email/jobs)
```

Degrades gracefully instead of failing. Requires: model availability detection + per-agent fallback config.

---
---

# PHASE 7: SYSTEM SOVEREIGNTY
## COOS Full Autonomy — OS-Level Agency

> *"Anti-gravity. COOS doesn't just run inside the system — it runs the system."*

---

### 1. The Vision

Everything built so far — agents, workers, Darwin's repair pipeline, the QA gate — all of it operates WITHIN the application boundary. COOS can fix its own code, but it cannot restart the server after fixing it. It can write tests, but cannot open a browser and SEE if the UI is broken. It knows when a service is down, but cannot bring it back up.

Phase 7 breaks that boundary.

When complete, COOS will:

- **Start its own server** — detect that the backend crashed and restart it without human intervention
- **Open a browser** — navigate to the running app, click through every panel, verify it works visually
- **Run the full project** — spin up backend + frontend together, run them, watch them, stop them
- **Debug in the browser** — read JS console errors, find the failing component, trace back to the source
- **Fix and redeploy** — apply the fix, restart the server, re-run the browser test, confirm resolved
- **Access system files** — read logs, config files, environment state — anything a developer on the terminal would see
- **Execute commands** — run shell commands with appropriate approval gates based on risk level

This is the difference between an assistant that helps you operate a computer and an OS that operates itself.

---

### 2. The Four Core Questions

#### Q1: How does COOS access the system?

**Current state:** COOS runs as a Python FastAPI process. It can read/write files in its own directory (Forge does this). It cannot run shell commands, access the process table, or talk to the OS.

**Phase 7 answer: The System Layer**

A new **System Layer** sits beneath the agent layer — not an AI agent itself, but a set of controlled OS interfaces:

```
┌─────────────────────────────────────────────────┐
│                  COOS Agents                     │
│  (Darwin, Oracle, Voyager, Commander, etc.)      │
├─────────────────────────────────────────────────┤
│              System Layer (new)                  │
│  ┌──────────┐ ┌──────────┐ ┌──────────────────┐ │
│  │ Process  │ │ Terminal │ │ Browser Control  │ │
│  │ Manager  │ │ Sandbox  │ │ (Playwright)     │ │
│  └──────────┘ └──────────┘ └──────────────────┘ │
│  ┌──────────┐ ┌──────────┐ ┌──────────────────┐ │
│  │ File     │ │ Service  │ │ Resource         │ │
│  │ Watcher  │ │ Registry │ │ Monitor          │ │
│  └──────────┘ └──────────┘ └──────────────────┘ │
├─────────────────────────────────────────────────┤
│               OS / Windows Kernel                │
└─────────────────────────────────────────────────┘
```

Each interface in the System Layer is:
- **Scoped** — it only does what it's designed for, no general `exec(arbitrary_command)`
- **Logged** — every system action is recorded with timestamp, agent, command, outcome
- **Gated** — actions are classified by risk tier (see Safety Framework below)

---

#### Q2: Can COOS run the project it has built?

**The Bootstrap Problem:**

COOS runs INSIDE the FastAPI server. If Darwin applies a code fix and needs to restart the server to test it — how does it restart itself?

If it kills the process, everything dies. If it doesn't restart, the fix is unapplied until a human restarts manually. This is the bootstrap problem.

**Solution: The Watchdog**

A lightweight `watchdog.py` process runs OUTSIDE of FastAPI, started by `restart.bat` (or a future `start.bat`). It is always alive, even when COOS crashes.

```
Windows Task Scheduler / boot
        │
        ▼
   watchdog.py  ←─────────────────────────────────────────────────┐
        │                                                          │
        ├── starts → uvicorn (COOS backend)                       │
        ├── starts → npm run dev (COOS frontend)                  │
        ├── monitors → both processes                              │
        ├── listens → for restart signal from COOS                │
        └── on crash or signal → restarts the appropriate process  │
                                                                   │
   COOS writes signal file:                                        │
   %TEMP%/coos_restart_signal.json                                 │
   {"target": "backend", "reason": "Darwin applied fix"}  ────────┘
```

Darwin applies a fix → writes `coos_restart_signal.json` → Watchdog picks it up → gracefully stops uvicorn → restarts it → COOS is back online with the fix applied → Voyager verifies.

The watchdog is intentionally small and dumb — it does one thing perfectly: keep COOS alive and respond to restart signals.

**Extended: Can COOS start a NEW project it has built?**

Yes. If Self-Create produces a standalone tool or service (e.g., a new API endpoint or a standalone script), COOS can:
1. Write the files (Forge)
2. Register it as a service in its own Service Registry
3. Start it via the Process Manager
4. Monitor it via the Resource Monitor
5. Expose it through its own API gateway

---

#### Q3: Where is the interface?

**Control Tower** — a new panel in the COOS frontend that shows everything happening at the system level in real time.

```
┌─────────────────────────────────────────────────────────────────┐
│  CONTROL TOWER                                    ● LIVE        │
├──────────────┬──────────────┬────────────────────┬─────────────┤
│  PROCESSES   │  BROWSER     │  TERMINAL          │  RESOURCES  │
│              │  SESSION     │  LOG               │             │
│ ● Backend    │              │                    │  CPU  ████░ │
│   uvicorn    │  [screenshot │  > python main.py  │  42%        │
│   PID 4821   │   of app     │  > npm run dev     │             │
│   ↑ healthy  │   running    │  > pytest tests/   │  RAM  ██░░░ │
│              │   in         │                    │  1.2GB      │
│ ● Frontend   │   headless   │  [PASS] 123/123    │             │
│   next dev   │   browser]   │  [INFO] Voyager    │  DISK ███░░ │
│   PID 8234   │              │        verified    │  34GB       │
│   ↑ healthy  │  Voyager:    │        homepage    │             │
│              │  "checking   │                    │             │
│ ● Redis      │   Job Apply  │  Darwin: applying  │             │
│   PID 2104   │   panel"     │  fix to routes/    │             │
│   ↑ healthy  │              │  chat.py           │             │
│              │  [PASS]      │                    │             │
│ ● Postgres   │  [FAIL]      │                    │             │
│   PID 1832   │  Dashboard   │                    │             │
│   ↑ healthy  │  chart error │                    │             │
└──────────────┴──────────────┴────────────────────┴─────────────┘
```

**Approval Panel (extended)** — System-level actions that carry real risk (delete a file, restart a service, run a shell command) surface here before execution. COOS pauses and waits. You see the exact command, the reason, the risk tier, and the expected outcome. Approve → it runs. Deny → COOS finds another path.

**Observatory → System Observatory** — The existing Observatory panel is enhanced to include system-level metrics: process health, restart history, Watchdog status, resource trends.

---

#### Q4: How does browser autonomy work?

**Voyager** — the autonomous browser agent.

Phantom (existing) is reactive: you give it a URL, it reads the page. Voyager is proactive: it navigates the entire app, interacts with it like a real user, and reports what broke.

```
Voyager test cycle:
  1. Start headless Chromium via Playwright
  2. Navigate to localhost:3000
  3. Screenshot every panel in the sidebar
  4. For each panel: perform the "golden path" interaction
     (click, fill a form, submit, verify response)
  5. Read the browser console for JS errors
  6. Check network tab for failing API calls
  7. Compare screenshots against last known-good baseline
  8. Report: PASS / FAIL per panel, with evidence
  9. If FAIL: hand off to Darwin with:
       - Screenshot of broken state
       - Console error text
       - Network request that failed
       - Which component is involved
  10. Darwin → Oracle → Forge → fix → Voyager re-runs that panel
```

Voyager also runs in **headed mode** (visible browser window) when you want to watch it work — like pair-programming with a robot. You can take control at any point.

---

### 3. New Agents & Systems

#### Agent: Commander
**Department:** IT Department  
**Level:** L3 (reports to Darwin)  
**Role:** Terminal access agent — translates agent intent into shell commands

Commander is the gatekeeper between agents and the OS terminal. No other agent runs shell commands directly. Every command goes through Commander, which:
- Classifies the command by risk tier
- Checks against the approval gate
- Executes and captures stdout/stderr
- Handles timeouts and process cleanup
- Logs everything to the IT audit trail

```python
# Commander intent examples
await Commander.run("npm install",          cwd="frontend/",  risk="low")
await Commander.run("pytest tests/ -v",     cwd="backend/",   risk="low")
await Commander.run("pip install requests", cwd=".",          risk="medium")
await Commander.run("rm -rf /tmp/build",    cwd=".",          risk="high")
# high risk → triggers Approval before execution
```

#### Agent: Voyager
**Department:** IT Department  
**Level:** L3 (reports to Darwin)  
**Role:** Autonomous browser agent — visual testing, UI verification, end-to-end flows

Voyager is built on Playwright and is significantly more powerful than Phantom:

| Phantom | Voyager |
|---------|---------|
| Reads one URL given by the user | Autonomously navigates the entire app |
| Reactive | Proactive — initiates its own test cycles |
| Returns text content | Returns screenshots, console logs, network traces |
| No interaction | Clicks, types, scrolls, submits forms |
| No baseline comparison | Compares against stored good-state screenshots |
| No error diagnosis | Hands structured failure reports to Darwin |

#### System: Watchdog (`watchdog.py`)
**Not an agent — a separate OS process.**

A 100-line Python script that lives outside of COOS and has one job: keep COOS alive and restart it when asked.

```python
# watchdog.py — simplified contract
class Watchdog:
    def monitor(self):        # checks process health every 5s
    def restart_backend(self): # graceful uvicorn restart
    def restart_frontend(self): # npm process restart
    def listen_for_signals(self): # reads coos_restart_signal.json
    def log_event(self, event):   # watchdog-level audit log
```

#### System: Process Manager
**Module:** `app/system/process_manager.py`

The Python interface that agents use to communicate with processes:

```python
class ProcessManager:
    def list_processes()     → list of running managed processes
    def start(name, cmd)     → start a named process
    def stop(name)           → graceful stop
    def restart(name)        → stop + start
    def signal_watchdog(cmd) → write to the watchdog signal file
    def get_resource_usage() → CPU, RAM, disk per process
```

#### System: Terminal Sandbox
**Module:** `app/system/terminal_sandbox.py`

Wraps Python `subprocess` with safety controls:

```python
class TerminalSandbox:
    RISK_TIERS = {
        "safe":    ["pytest", "pip list", "npm list", "git status", "python --version"],
        "low":     ["npm install", "pip install", "git pull", "npm run build"],
        "medium":  ["uvicorn restart", "npm run dev", "python main.py"],
        "high":    ["rm", "del", "git reset --hard", "DROP TABLE"],
        "blocked": ["format", "shutdown", "regedit"],  # never allowed
    }
    
    def run(cmd, cwd, risk, timeout=30) → CommandResult
    # If risk >= "high": raises ApprovalRequired exception
    # Darwin/Commander catches it, creates an approval request
    # Waits for user to approve in the Approvals panel
    # Then re-runs the command
```

#### System: File Watcher
**Module:** `app/system/file_watcher.py`

Monitors the project directory for changes and notifies relevant agents:

```python
class FileWatcher:
    # Watches: backend/python/, frontend/src/, docs/
    # Events:
    #   file_modified → notify Sentry (may indicate external edit)
    #   file_created  → notify Darwin (new file may need integration)
    #   file_deleted  → alert immediately (could be accidental)
    #   requirements_changed → trigger pip install
    #   package_json_changed  → trigger npm install
```

---

### 4. The Full Autonomous Repair Cycle (Phase 7 Complete)

When Phase 7 is complete, a production error goes through this pipeline entirely without human intervention (for auto-approvable error types):

```
1. Sentry detects error in production logs
        │
        ▼
2. Darwin wakes up → Oracle diagnoses
        │
        ▼
3. Aria Gate 1: Verdict reviews the proposed fix
        │ approved
        ▼
4. Approval gate (auto-approved for safe error types, otherwise pauses)
        │ approved
        ▼
5. Forge applies the fix to source file
        │
        ▼
6. Commander runs: pytest tests/ --tb=short
        │
        ▼
7. Aria Gate 2: Probe reads test results
        │ all passing
        ▼
8. Darwin signals Watchdog: restart backend
        │
        ▼
9. Watchdog restarts uvicorn (COOS is briefly offline ~3 seconds)
        │
        ▼
10. Voyager opens the app in a headless browser
    → Navigates to affected panel
    → Performs golden path interaction
    → Reads console for new errors
        │ all clear
        ▼
11. Aria Gate 3: Pulse checks all API endpoints
        │ all healthy
        ▼
12. Darwin marks ticket: RESOLVED
    → Push notification: "Fixed: [error description]"
    → Log entry with full audit trail
    → Screenshot evidence from Voyager stored in storage
```

**Total time for a typical bug:** 2–5 minutes, zero human input.

---

### 5. Safety Framework — The Power Must Have Rules

This is not optional. Giving an LLM-driven system OS-level access without a safety framework is a serious mistake. Every decision here is intentional.

#### Rule 1: Tiered Risk, Tiered Approval

| Risk Tier | Examples | Approval Required | Auto-Allowed |
|-----------|----------|-------------------|--------------|
| Safe | Read files, list processes, run tests | Never | Always |
| Low | Install packages, run dev server, git status | Never | Always |
| Medium | Restart a service, write to a config file | User can toggle | Off by default |
| High | Delete files, force-push, drop DB tables | Always | Never |
| Blocked | Format drives, system shutdown, regedit | Blocked in code | Never |

The Autonomy settings in the Settings panel control which Medium-tier actions are auto-approved. Everything High goes to the Approvals panel, always.

#### Rule 2: Every System Action Is Logged

The IT audit log records every command Commander runs:
```
[2026-06-28 14:23:11] Commander → pytest tests/ -v
  risk: safe, duration: 12.3s, exit_code: 0, stdout: 123 passed
  
[2026-06-28 14:23:24] Commander → uvicorn restart
  risk: medium, approved_by: auto (autonomy setting), duration: 3.1s
  
[2026-06-28 14:25:01] Commander → rm backend/python/old_file.py
  risk: high, approved_by: VJ (Approvals panel at 14:24:58)
```

This log is visible in the Control Tower panel and queryable by Atlas.

#### Rule 3: COOS Cannot Delete Itself

Commander's TerminalSandbox has a hardcoded protection list:
- Cannot delete or overwrite: `main.py`, `watchdog.py`, `db/init.py`, any `.env` file
- Cannot `DROP TABLE` on any core table (agents, semantic_memories, chat_sessions)
- Cannot kill the Watchdog process

#### Rule 4: Voyager Cannot Click Destructive Actions

Voyager's browser automation has an element blacklist — it will never autonomously click:
- "Delete" buttons that contain confirmation dialogs it hasn't been explicitly told to handle
- Payment or billing forms
- Any button whose accessible text contains: delete, destroy, purge, drop, terminate, cancel subscription

#### Rule 5: The Human Override Is Always One Click

The Approvals panel is always accessible from the sidebar. One click: "Deny All" freezes all pending system actions. You are never locked out of your own machine.

---

### 6. Implementation Phases

This is too large to build in one go. Here is the correct build order:

#### Phase 7A: Commander + Terminal Sandbox
Build the safe terminal access layer first. No browser, no watchdog yet.
- `terminal_sandbox.py` with risk tier classification
- `process_manager.py` basic version (list processes, get resource usage)
- Commander agent wired into Darwin's repair cycle
- Control Tower panel (basic): process list + terminal log stream
- **Unlock:** Darwin can run `pytest` directly instead of spawning a subprocess inside Probe

#### Phase 7B: Watchdog + Self-Restart
Solve the bootstrap problem.
- `watchdog.py` — external process, started by updated `restart.bat`
- Signal file protocol: COOS writes → Watchdog reads → restarts
- Darwin can now apply a fix AND restart the server to test it live
- Observatory panel shows Watchdog status + restart history

#### Phase 7C: Voyager — Browser Autonomy
Build the visual testing agent.
- Voyager agent class using Playwright (BrowserTool already exists as foundation)
- Golden path test suite: one test per panel in COOS
- Screenshot baseline storage (uses existing storage service)
- Darwin repair cycle extended: after Probe passes → Voyager runs the affected panel
- Control Tower: live browser screenshot stream

#### Phase 7D: File Watcher + Full Autonomy Loop
The final piece — reactive system intelligence.
- FileWatcher monitoring project directory
- Auto-trigger npm install on package.json change
- Auto-trigger pip install on requirements.txt change
- Full end-to-end repair cycle: Sentry → Darwin → Forge → Commander → Watchdog → Voyager → resolved

#### Phase 7E: Multi-Project Awareness
COOS can manage more than itself.
- Service Registry: register external projects (other repos, services)
- Commander can start/stop registered services
- Voyager can test them
- COOS becomes a DevOps operator for your entire local development environment

---

### 7. New UI: Control Tower Panel

The Control Tower is the window into everything Phase 7 introduces. It lives in the sidebar alongside IT Department and Observatory.

**Layout:**
```
Control Tower
├── Processes tab     → list of managed processes, PID, health, uptime, restart button
├── Browser tab       → live Voyager session: screenshot, current URL, console errors
├── Terminal tab      → live stream of Commander's output (like a read-only terminal)
├── Resources tab     → CPU/RAM/Disk/Network graphs, per-process breakdown
└── Audit tab         → chronological log of every system action taken by COOS
```

**Live indicators in the sidebar:**
- Green dot: all managed processes healthy
- Yellow dot: one or more degraded (high resource usage, slow response)
- Red dot: one or more crashed — Darwin is already on it
- Orange dot: waiting for your approval before proceeding

---

### 8. Technical Dependencies

| Dependency | Purpose | Status |
|------------|---------|--------|
| `psutil` | Process enumeration, resource monitoring | Not installed |
| `playwright` | Voyager browser automation | Partially referenced |
| `watchdog` (Python lib) | File system change detection | Not installed |
| `subprocess` | Shell command execution | Available in stdlib |
| `asyncio.create_subprocess_exec` | Async subprocess | Available in stdlib |
| Windows Task Scheduler / pm2 | External watchdog management | Not set up |

Install additions needed:
```
psutil==6.0.0
playwright==1.44.0
watchdog==4.0.0
```

Frontend additions:
```
# No new packages — uses existing SSE streaming + screenshot display
```

---

### 9. What Makes This Different From Just "Running Shell Commands"

A naive version of this would be: give the LLM a `run_command()` tool and let it do whatever. That is dangerous, unpredictable, and will eventually destroy something important.

What Phase 7 builds is different:

| Naive approach | COOS Phase 7 |
|----------------|--------------|
| LLM calls run_command() freely | All commands go through Commander with risk classification |
| No audit trail | Every action logged with agent, timestamp, outcome |
| LLM decides what's safe | Risk tiers are hardcoded — not subject to LLM judgment |
| One shot — if it goes wrong, it goes wrong | Watchdog provides recovery; Approvals panel provides veto |
| Can't see the result visually | Voyager verifies visually, not just by exit code |
| No concept of "your data" vs "system data" | Protection list hardcodes what COOS cannot touch |
| User has no visibility | Control Tower shows everything live |

The power is real. The rules are what make it trustworthy.

---

### 10. The Name

Phase 7 internally is called **System Sovereignty** — the point at which COOS transitions from an AI assistant running on your computer to an operating system that runs itself.

The agents that make it possible are called the **System Corps** — Commander, Voyager, and the Watchdog — sitting below Darwin and reporting to him directly.

```
VJ
└── Jazper (Chief of Staff)
    └── Darwin (IT Dept Head)
        ├── Oracle       [diagnose]
        ├── Forge        [write code]
        ├── Aria         [QA gate]
        │   ├── Verdict  [static review]
        │   ├── Probe    [test runner]
        │   └── Pulse    [endpoint smoke]
        ├── Commander    [terminal access]  ← Phase 7A
        ├── Voyager      [browser autonomy] ← Phase 7C
        └── Scroll       [documentation]
        
External (not agents):
        ├── Watchdog     [process guardian] ← Phase 7B
        └── FileWatcher  [change detector]  ← Phase 7D
```

When VJ goes to sleep, the company keeps running. That is System Sovereignty.

---
---

# PHASE 8: COOS STUDIO
## The Developer Cockpit — IDE + Control Tower + Agent Vision

> *"You don't just watch COOS work. You sit in the cockpit while it flies."*

---

### 1. The Question Behind the Question

When you ask "can I see on screen how it's working?" and "should we have an IDE?" — you're asking the same thing from two directions.

**Direction 1 — Control Tower (Phase 7):**
You can see: is the system alive? what processes are running? what commands are being executed? what did the terminal output?

**Direction 2 — IDE:**
You can see: what is the *code* doing? what did Forge actually write? which line is Oracle reading to diagnose? what changed between the broken version and the fixed version?

Neither is complete without the other. Together they form **COOS Studio** — the full cockpit.

Think of it like a spacecraft:
- The **Control Tower** is mission control — systems status, telemetry, process health
- The **IDE** is the instrument panel — the actual code, the edits, the diffs, what's going in and out

When COOS Studio is open, you see both. You are not watching a black box do things. You are in the room where it happens.

---

### 2. Why Not Just Use VS Code?

This is the right question to ask. VS Code is an excellent IDE. So why build one inside COOS?

| VS Code | COOS Studio IDE |
|---------|-----------------|
| You open files manually | Files open automatically when an agent touches them |
| You see edits after they're saved | You see Forge writing in real-time, line by line |
| Diff is just a git tool | Diff IS the approval flow — you approve Forge's fix from the diff |
| Errors are in a separate terminal | Test failures link directly to the failing line in the editor |
| You switch between VS Code and COOS | Everything is one screen, one context |
| VS Code doesn't know which agent caused the edit | COOS Studio shows: "Forge edited line 52 because Oracle found a NullPointerError" |
| No connection to agent reasoning | Click an agent activity event → jump to the exact code it touched |

The COOS Studio IDE is not competing with VS Code. It's a **different product** — an IDE whose entire purpose is to be the visual layer for an AI operating system. The code editor is just one part of it. The agent awareness is the whole point.

You will still use VS Code for serious development. COOS Studio is for *watching and collaborating with your agents* — understanding what they're doing and stepping in when you want to.

---

### 3. The Technology

**Monaco Editor** — the same code editor that powers VS Code, available as an open-source React component.

```
@monaco-editor/react    ← the React wrapper
monaco-editor           ← the editor itself (auto-installed as a peer dep)
```

What Monaco gives for free:
- Full syntax highlighting for Python, TypeScript, JSON, Markdown, YAML, etc.
- A built-in **DiffEditor** — side-by-side old vs new, with line-level highlighting
- Read-only OR editable modes (so you can lock the editor during agent edits)
- Keyboard shortcuts, find-and-replace, multi-cursor, minimap
- No server needed — runs entirely in the browser
- MIT license

This is not building an IDE from scratch. This is wrapping the world's best open-source editor in a COOS-aware interface. The editor is solved. The unique work is making it **agent-aware**.

---

### 4. What COOS Studio Looks Like

COOS Studio is a **mode**, not a panel. When you activate it, the entire UI transforms from the normal sidebar-panel layout into a full-screen developer cockpit.

```
╔══════════════════════════════════════════════════════════════════════════════════════╗
║  SIR JAZPER OS — COOS STUDIO                               [Studio ●] [Normal Mode] ║
╠═════════════╦══════════════════════════════════════════╦══════════════════════════════╣
║  FILE TREE  ║           CODE EDITOR                    ║   AGENT ACTIVITY FEED       ║
║             ║                                          ║                              ║
║ ▼ backend/  ║  routes/chat.py  ×   agents/forge.py     ║  ● Now                      ║
║   ▼ app/    ║                                          ║  14:23 Oracle                ║
║     agents/ ║  45  @router.post("/chat")               ║         reading              ║
║     routes/ ║  46  async def chat_endpoint(            ║         routes/chat.py       ║
║     workers/║  47      req: ChatRequest,               ║         lines 45–67          ║
║     system/ ║  48  ) -> StreamingResponse:             ║         "looking for the     ║
║ ▼ frontend/ ║  49      session_id = req.session_id     ║          NullPointer origin" ║
║   ▼ src/    ║  50      if not session_id:              ║                              ║
║     app/    ║  51 ▶        session_id = str(uuid4())   ║  14:24 Forge                 ║
║     comps/  ║  52 ●  [Forge is writing here]           ║         applying fix         ║
║     hooks/  ║  53                                      ║         line 52 → 53         ║
║ ▼ docs/     ║  54  ...                                 ║         [DIFF PREVIEW]       ║
║             ║                                          ║         Approve  Deny        ║
║  [search]   ║                                          ║                              ║
║             ║                                          ║  14:25 Commander             ║
╠═════════════╩═══════════════╦════════════════╦═════════║         pytest tests/        ║
║  DIFF / APPROVAL            ║  GIT           ║ SYSTEM  ║         123/123 ✓            ║
║                             ║                ║         ║                              ║
║  Forge proposes:            ║  8d60f60  fix  ║ ● back  ║  14:26 Voyager               ║
║  - session_id = None        ║  eaada23  init ║ ● front ║         checking             ║
║  + session_id = str(uuid4)  ║                ║ ● redis ║         ChatPanel            ║
║                             ║  [Commit ↗]    ║ ● psql  ║         [SCREENSHOT]        ║
║  Confidence: 94%            ║                ║         ║         PASS                 ║
║  [Approve ✓]  [Deny ✗]     ║                ║         ║                              ║
╚═════════════════════════════╩════════════════╩═════════╩══════════════════════════════╝
```

**Five zones in Studio Mode:**

| Zone | What it shows |
|------|---------------|
| **File Tree** (left) | Project directory. Files glow when an agent is touching them. Click to open. |
| **Code Editor** (center) | Monaco editor. Tabs for multiple open files. Agents open files here automatically. |
| **Agent Activity Feed** (right) | Live stream of what every agent is doing, with links back to the code. |
| **Diff / Approval** (bottom-left) | When Forge proposes a fix: this shows the exact diff and the Approve/Deny buttons. This replaces the standalone Approvals panel in Studio Mode. |
| **Git + System** (bottom-right) | Recent commits, current branch, process health indicators (the miniature Control Tower). |

---

### 5. The Agent-Aware Editor — The Key Differentiator

This is what makes COOS Studio different from every other IDE ever built.

#### 5.1 Files open themselves

When Oracle starts reading `routes/chat.py` to diagnose an error, the file opens in the editor. The lines it's analyzing are highlighted in blue. You see exactly what Oracle is looking at.

When Forge starts applying a fix, the cursor moves to the target line. Characters appear as Forge writes them — streamed from the backend in real-time. You can watch the edit happen.

#### 5.2 The activity feed is linked

Every event in the Agent Activity Feed is clickable:
```
14:23 Oracle reading routes/chat.py lines 45–67
      "looking for the NullPointer origin"
```
Click that → editor jumps to `routes/chat.py:45`, those lines are highlighted, Oracle's reasoning is shown in a tooltip on the gutter.

#### 5.3 Approve from the diff

Currently, Approvals happen in a separate panel with a crude text diff. In COOS Studio, when Forge proposes a change, **Monaco's built-in DiffEditor activates in the bottom-left zone** — a proper side-by-side diff with line-level syntax highlighting, identical to how you'd review a GitHub PR. The Approve/Deny buttons sit right below it. You never leave the editor to make the call.

#### 5.4 Errors link to lines

When Commander runs `pytest tests/ -v` and a test fails:
```
FAILED tests/test_agents.py::test_scout_smoke - AttributeError: 'str' has no attribute 'prompt_tokens'
```
Click the failure in the Activity Feed → editor jumps to `tests/test_agents.py`, that test's line is marked with a red gutter indicator, and the stack trace is shown as inline error annotations — exactly like VS Code's Python error squiggles.

#### 5.5 You can always edit

The editor is not read-only. Any time an agent is not actively writing, you can click into any file and edit directly. Your edit is saved, and Forge/Oracle will see it the next time they read that file.

If an agent is mid-edit and you want to take over: click **Pause Agent** in the Activity Feed. The editor becomes fully yours. Click **Resume** to let the agent continue from where you left off.

---

### 6. The Five Panels in Detail

#### Panel 1: File Tree

```
▼ backend/python/
    ▼ app/
        agents/          ← 3 files modified today
          ├── oracle_agent.py     ● (Oracle just read this)
          ├── forge_agent.py
          └── base_agent.py
        routes/
          ├── chat.py             ● (Forge editing)
          └── memory.py
        workers/
    main.py
▼ frontend/src/
    ▼ components/panels/
        ChatPanel.tsx             ● (Voyager screenshot pending)
    app/page.tsx
▼ docs/
    roadmap/future_upgrades.md   ← you are reading this
```

- **Orange dot** = agent is currently touching this file
- **Blue dot** = file was read/modified in the last hour by an agent
- **Right-click** = open, rename, delete (with approval gate for destructive actions)
- **Search bar** at bottom: fuzzy file search (like VS Code Ctrl+P)

#### Panel 2: Code Editor (Monaco)

Full Monaco editor. Tabs at the top for multiple open files. Per-tab state (cursor position, scroll position, unsaved changes).

**Gutter annotations** (left margin of the code):
- 🔵 Blue circle = Oracle is reading this block
- 🟡 Yellow pencil = Forge is editing here
- 🔴 Red X = test failure references this line
- 🟢 Green check = Voyager verified this component passes

**Agent mode indicator** in the tab bar:
```
routes/chat.py ✏ Forge [editing]    ×
oracle_agent.py  👁 Oracle [reading]  ×
```

#### Panel 3: Agent Activity Feed

Real-time SSE stream. Every agent action in the system that touches code shows up here.

```
NOW
14:26:03  ● Voyager        Opened localhost:3000/chat
                            Screenshot: [thumbnail]
                            Result: PASS — no console errors

14:25:47  ● Commander       pytest tests/ -v
                            Exit code: 0 in 12.3s
                            123 passed — [view output]

14:24:51  ● Forge           Applied fix to routes/chat.py:52
                            old: session_id = None
                            new: session_id = str(uuid4())
                            [View diff] [Revert]

14:24:22  ● Aria/Verdict    Reviewed diff — APPROVED
                            "No critical issues. Confidence 94%."

14:24:01  ● Oracle          Diagnosed: NullPointerError
                            Source: session_id not initialized
                            File: routes/chat.py, line 52
                            Fix confidence: 94%
                            [View diagnosis]

14:23:44  ● Sentry          Error detected in error_log
                            "NoneType has no attribute 'session_id'"
                            Woke Darwin → Darwin started repair
```

Each entry has a timestamp, agent name, one-line summary, expandable detail, and relevant action links (View diff, View output, Revert, etc.).

#### Panel 4: Diff / Approval Zone

When no approval is pending: shows the current git diff (`git diff HEAD`) as a read-only Monaco DiffEditor. You always see what's changed since the last commit.

When Forge proposes a fix and awaits approval:
- DiffEditor switches to that specific change
- Confidence score shown
- Oracle's diagnosis text shown (why this fix)
- **Approve** button (green) — fix applies immediately
- **Deny** button (red) — fix is rejected, Darwin tries again
- **Edit** button (blue) — you take over, Monaco becomes editable, you write your own fix and hit "Apply Mine"

The "Edit then Apply" flow is important: if Forge got it 90% right, you fix the last 10% yourself directly in the diff view. No copy-pasting between apps.

#### Panel 5: Git + System Status

**Git (left half):**
```
Branch: main          [Commit ↗]  [Pull]

Uncommitted changes:
  M  backend/python/app/routes/chat.py
  M  backend/python/tests/test_agents.py

Recent commits:
  8d60f60  Fix session init bug     14:24
  eaada23  Initial commit           Jun 26
```

**System (right half):**
```
PROCESSES
  ● backend    PID 4821   CPU 2%   RAM 112MB  ↑ 2h14m
  ● frontend   PID 8234   CPU 1%   RAM 340MB  ↑ 2h14m
  ● redis      PID 2104   CPU 0%   RAM  22MB  ↑ 2h14m
  ● postgres   PID 1832   CPU 0%   RAM 180MB  ↑ 2h14m
  ○ watchdog   PID  991   external            ↑ 2h14m
```

All processes clickable → opens full Control Tower panel for that process.

---

### 7. How Control Tower Fits In

Control Tower (Phase 7) remains as its own sidebar panel — a full-screen view focused entirely on system operations: process manager, browser session, terminal output, resource graphs.

COOS Studio **embeds a miniature Control Tower** in its bottom-right zone — just the process health bars and quick-action buttons. If you want the full Control Tower detail, you click "Expand" and it takes over the right half of the screen within Studio Mode.

The relationship:
- **Normal mode** → sidebar navigation, each panel is full-screen, Control Tower is one panel
- **Studio Mode** → all-in-one cockpit, Control Tower is a widget within it
- Both are always available, you switch with one click in the Topbar

---

### 8. Backend Architecture

Four new backend pieces:

#### 8.1 IDE API Routes (`app/routes/ide.py`)

```python
GET  /api/ide/tree              → full project file tree as JSON
GET  /api/ide/file?path=...     → read file content
PUT  /api/ide/file?path=...     → write file content (risk: medium → approval)
GET  /api/ide/search?q=...      → fuzzy search filenames
GET  /api/ide/grep?q=...        → search file contents
GET  /api/ide/events            → SSE stream of agent file activity
GET  /api/ide/git/status        → current git status
GET  /api/ide/git/diff          → git diff HEAD
GET  /api/ide/git/log?n=20      → last N commits
POST /api/ide/git/commit        → git commit with message (risk: low)
```

#### 8.2 Agent Activity Broadcaster

A thin event bus: when Oracle, Forge, or Voyager touches a file, they emit to the IDE event bus. The `/api/ide/events` SSE endpoint broadcasts these to the Studio frontend.

```python
# In oracle_agent.py — when it reads a file:
await ide_bus.emit({
    "agent": "Oracle",
    "action": "reading",
    "file": file_path,
    "lines": [start_line, end_line],
    "reason": "diagnosing NullPointerError",
})

# In forge_agent.py — when it writes:
await ide_bus.emit({
    "agent": "Forge",
    "action": "editing",
    "file": file_path,
    "line": target_line,
    "old": old_string[:100],
    "new": new_string[:100],
})
```

Every existing agent gets ~3 lines of emit code added. The bus is non-blocking — if the IDE isn't open, events are simply dropped.

#### 8.3 File Tree Builder

```python
def build_tree(root: str, ignore: list[str]) -> dict:
    # Walks project directory, skips: node_modules, __pycache__, .git, venv
    # Returns nested JSON: {name, type, path, children?, modified_at, agent_active?}
```

The `agent_active` field is set by the IDE bus — if Oracle is currently reading `oracle_agent.py`, that file's node has `"agent_active": "Oracle"` → the frontend shows the orange dot.

#### 8.4 Git Integration

Simple subprocess wrappers — no `gitpython` dependency needed:

```python
def git_status() → dict         # subprocess: git status --porcelain
def git_diff()   → str          # subprocess: git diff HEAD
def git_log(n)   → list[dict]   # subprocess: git log --oneline -n
def git_commit(msg) → dict      # subprocess: git add -A && git commit -m msg
```

All via `TerminalSandbox` (Phase 7A) with appropriate risk tiers. `git commit` is risk `low`. `git reset --hard` is risk `high` → requires Approval.

---

### 9. Frontend Architecture

Four new frontend pieces:

#### 9.1 `StudioLayout.tsx`

A top-level layout component that replaces the normal `<Sidebar> + panel` layout when Studio Mode is active. Uses CSS Grid with 5 named zones:

```tsx
<div style={{ display: "grid", gridTemplate: `
  "tree editor  activity" 1fr
  "diff  git-sys git-sys" 260px
  / 220px 1fr   300px
`}}>
  <FileTree       area="tree"     />
  <CodeEditor     area="editor"   />
  <ActivityFeed   area="activity" />
  <DiffApproval   area="diff"     />
  <GitSystem      area="git-sys"  />
</div>
```

A `[Studio Mode]` toggle button in the Topbar activates it. ESC or clicking `[Normal Mode]` goes back.

#### 9.2 `CodeEditor.tsx`

Wraps `@monaco-editor/react`. Two modes:
- **View mode** — `Editor` component, read-only when an agent is editing, editable otherwise
- **Diff mode** — `DiffEditor` component, activated when the Diff/Approval zone has a pending approval

```tsx
import Editor, { DiffEditor } from "@monaco-editor/react"

// Gutter decorations for agent activity:
const decorations = agentActivity.map(event => ({
  range: new monaco.Range(event.line, 1, event.line, 1),
  options: {
    glyphMarginClassName: `agent-gutter-${event.agent.toLowerCase()}`,
    glyphMarginHoverMessage: { value: `${event.agent}: ${event.reason}` },
  }
}))
```

#### 9.3 `FileTree.tsx`

Recursive tree component. Fetches from `/api/ide/tree` on mount and refreshes every 30s (or on FileWatcher SSE events in Phase 7D). Files with `agent_active` get a pulsing orange dot in their icon.

#### 9.4 `ActivityFeed.tsx`

Consumes the `/api/ide/events` SSE stream. Renders a reverse-chronological list of agent events. Each event card has:
- Agent name + color-coded badge (Oracle = blue, Forge = yellow, Voyager = purple, Commander = green)
- Timestamp
- One-line summary
- Expandable detail section
- Click → `editor.revealLine(event.line)` to jump to the code

---

### 10. Build Plan — Phase 8

**Phase 8A: IDE Core** (no Phase 7 dependencies — can build now)

- [ ] `npm install @monaco-editor/react`
- [ ] `app/routes/ide.py` — file tree + read file + write file endpoints
- [ ] `FileTree.tsx` — expandable directory tree component
- [ ] `CodeEditor.tsx` — Monaco wrapper, file tabs, read/write mode toggle
- [ ] `IDEPanel.tsx` — single-panel view (accessible from sidebar like any panel)
- **Result:** You can browse and edit any project file from within COOS

**Phase 8B: Agent Awareness** (requires Phase 7A Commander hooks)

- [ ] `ide_bus.py` — lightweight event bus (in-memory pub/sub, SSE endpoint)
- [ ] Add `ide_bus.emit()` to: Oracle, Forge, Aria/Verdict, Voyager
- [ ] `ActivityFeed.tsx` — live SSE event stream component
- [ ] File Tree — orange dot when file is agent-active (from SSE)
- [ ] Editor gutter decorations — colored icons per agent
- **Result:** Files open automatically when agents touch them; you watch agents work in real-time

**Phase 8C: Approval Integration** (replaces crude Approvals text diff)

- [ ] `DiffApproval.tsx` — Monaco DiffEditor + Approve/Deny/Edit buttons
- [ ] Wire into existing approval_service SSE stream — when `approval_requested` arrives, DiffApproval activates
- [ ] "Edit then Apply" flow — user edits the diff, hits "Apply Mine" → writes file directly
- [ ] Deprecate the crude text diff block in `ApprovalsPanel.tsx` (redirect to Studio)
- **Result:** Forge's fixes reviewed in a proper syntax-highlighted diff, approved from the editor

**Phase 8D: Git Panel + Studio Mode Layout** (polish + final integration)

- [ ] `app/routes/ide.py` — add git status/diff/log/commit endpoints
- [ ] `GitSystem.tsx` — git status, recent commits, commit button
- [ ] `StudioLayout.tsx` — the full 5-zone cockpit layout
- [ ] Topbar `[Studio Mode]` toggle button
- [ ] Miniature Control Tower widget in the System zone (pulls from Phase 7 process list)
- [ ] Keyboard shortcut: `Ctrl+Shift+S` → toggle Studio Mode
- **Result:** Full COOS Studio cockpit — the complete developer experience inside COOS

---

### 11. What Phase 8 Unlocks

After Phase 8 is complete, here is what a typical bug-fix session looks like:

```
VJ is in Studio Mode. Everything is running normally.

14:23  Sentry detects an error. The Activity Feed lights up:
       "Sentry → Error detected → Darwin waking up"

14:23  A file in the File Tree glows orange:
       routes/chat.py  ● Oracle [reading]

14:23  The editor opens routes/chat.py automatically.
       Lines 45–67 are highlighted in blue.
       Oracle's reasoning appears in the Activity Feed:
       "NullPointerError: session_id is None on first request"

14:24  The editor shows Forge starting to write.
       The cursor moves to line 52. Characters appear.
       The Activity Feed shows: "Forge proposing fix"

14:24  The Diff/Approval zone activates.
       Monaco DiffEditor shows:
         -  session_id = None
         +  session_id = str(uuid4())
       Verdict has already approved (94% confidence).
       Two buttons: [Approve ✓]  [Deny ✗]  [Edit ✎]

14:24  VJ clicks [Approve ✓].
       The Activity Feed: "Commander → pytest tests/ -v → 123/123 ✓"

14:25  Voyager opens a headless browser. A screenshot appears in the Activity Feed.
       "ChatPanel → PASS — no console errors"

14:25  The Git zone shows a new uncommitted change.
       VJ types a commit message: "fix: initialize session_id on first request"
       Clicks [Commit ↗].

14:26  Done. Total time: 3 minutes. VJ made exactly two decisions:
       Approve, and write the commit message.
       Everything else was COOS.
```

That is the experience. That is why the IDE is not separate from Phase 7 — it is the lens through which Phase 7 becomes visible and collaborative.

---

### 12. New Dependencies Summary

```
# Frontend
@monaco-editor/react    ^4.6.0   # Monaco editor React wrapper

# Backend (all stdlib or already installed)
subprocess              stdlib   # git commands (via TerminalSandbox)
asyncio                 stdlib   # SSE event bus
os.walk                 stdlib   # file tree builder
```

No heavy new dependencies. Monaco is large (~5MB bundle) but lazy-loaded only when Studio Mode is activated — it doesn't affect the normal COOS load time.

---

### 13. The Updated Full Architecture

```
VJ (in Studio Mode or Normal Mode)
│
├── Studio Mode (Phase 8)
│   ├── File Tree       ← project directory, agent-active indicators
│   ├── Code Editor     ← Monaco, tabs, gutter annotations, agent cursor
│   ├── Activity Feed   ← live SSE: every agent file action
│   ├── Diff/Approval   ← Monaco DiffEditor + Approve/Deny/Edit
│   └── Git + System    ← git status/log/commit + mini Control Tower
│
└── Normal Mode (existing sidebar panels)
    ├── Control Tower   ← full-screen process/terminal/browser/resources view
    ├── IT Department   ← tickets, QA gate results, approval links
    ├── Approvals       ← approval queue (Studio Mode bypasses this)
    └── ... all other panels

Agents (what Studio is the window into):
├── Oracle    → emits "reading file X, lines Y–Z, reason: ..."
├── Forge     → emits "editing file X, line Y, old→new"
├── Voyager   → emits "screenshot, URL, result: PASS/FAIL"
├── Commander → emits "running command, exit code, duration"
└── Aria      → emits "gate result, approved/blocked"

System Layer (Phase 7):
├── Process Manager   → feeds System widget in Studio
├── Terminal Sandbox  → Commander routes through here
├── Watchdog          → external, status shown in System widget
└── File Watcher      → triggers File Tree refresh in Studio
```

---

### 14. The Name

**COOS Studio** — the developer cockpit of Sir Jazper OS.

It is not an IDE you use to write code from scratch. It is the *observation deck and command interface* for an AI that writes its own code. You are the engineering lead. The agents are your team. Studio is the open-plan office where you can see exactly what everyone is doing, step in when needed, and approve what you want shipped.

When COOS Studio is open, there are no black boxes. Every agent action is visible, every file change is reviewable, every decision is yours to confirm or override.

---

