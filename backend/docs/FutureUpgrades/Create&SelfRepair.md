# Sir Jazper — IT Department: Self-Repair & Self-Create

Version: 1.0
Status: Design Phase — Not Yet Implemented
Author: Vijay Moirangthem
Last Updated: June 2026
Target: After Phase 4 completion

---

## 1. The Core Idea

Right now, Sir Jazper is a team of specialist agents coordinated by one orchestrator. When something breaks or a new feature is needed, **you** are the engineer who fixes or builds it.

The IT Department flips this. Jazper gets its own internal software team — a group of AI agents whose only job is to maintain, debug, and extend the Jazper codebase itself. When something breaks at 3 AM, the IT Department wakes up, diagnoses it, fixes it, and tells you what it did. When you say "I want a new feature", the IT Department specs it, builds it, tests it, and deploys it.

**You become the CTO, not the developer.**

---

## 2. The Team

```
You (Director — final approval on all changes)
        |
   Darwin (Engineering Manager — coordinates the team)
        |
   +----+------------------+----------+---------+
   |         |             |          |         |
Oracle     Forge         Shield    Scroll    Sentry
Diagnose   Build         Test      Docs      Monitor
```

Each agent has a single, well-defined responsibility. No agent does two jobs. This is the same principle that makes the main Jazper agent roster work — specialisation beats generalism.

---

## 3. Agent Profiles

### Darwin — Engineering Manager

Coordinates the team. Receives the task (bug report or feature request), breaks it into sub-tasks, assigns them to the right agents, manages the workflow, and presents the final result to you for approval.

**Model:** llama-3.3-70b-versatile (Groq)
**Reason:** Needs strong reasoning to plan multi-step work correctly.
**Hard rule:** Never writes code, makes commits, or deploys without explicit human approval.

**Responsibilities:**
- Understand what was asked (natural language to technical spec)
- Decide: is this a repair job or a create job?
- Assign sub-tasks to Oracle, Forge, Shield, Scroll in order
- Collect results, check for conflicts
- Present a clear summary to you before any change is made
- Track the full operation in the audit log

---

### Oracle — The Diagnostician

Reads logs, tracebacks, error messages, and source code to identify exactly what is broken and why. Does not fix anything — only diagnoses.

**Model:** llama-3.3-70b-versatile (Groq)
**Reason:** Code reasoning over complex tracebacks needs the strongest available model.

**Tools:**
- read_file(path) — reads any file in the codebase
- read_logs(tail=100) — reads recent log entries
- search_codebase(query) — semantic search across Python/TypeScript files
- read_traceback(error_id) — fetches a specific error from the error store

**Output — structured diagnosis report:**
```json
{
  "root_cause": "HermesAgent calls stream_with_tools() with await but it is an async generator",
  "file": "backend/python/app/agents/hermes_agent.py",
  "line": 58,
  "affected_agents": ["Hermes"],
  "severity": "high",
  "confidence": 0.95,
  "suggested_fix": "Remove await, iterate directly with async for"
}
```

**Key rule:** Oracle reads widely but concludes narrowly. It must pinpoint the exact line, not just the general area. If confidence is below 0.70, it says so — Darwin escalates to you rather than guessing.

---

### Forge — The Developer

Writes the actual code. Takes Oracle's diagnosis (for repair) or Darwin's spec (for create) and produces working Python or TypeScript.

**Model:** llama-3.3-70b-versatile (Groq)
**Reason:** Code quality matters. Smaller models write plausible but subtly broken code.

**Tools:**
- read_file(path) — must read before modifying
- write_diff(path, old_string, new_string) — targeted edits only, never full rewrites
- create_file(path, content) — only for Self-Create, never for repair
- read_agent_template() — reads BaseAgent to ensure new agents follow the pattern

**Output — change set:**
```json
{
  "changes": [
    {
      "file": "backend/python/app/agents/hermes_agent.py",
      "type": "edit",
      "old": "result = await ai_provider.stream_with_tools(...)",
      "new": "async for item in ai_provider.stream_with_tools(...):",
      "explanation": "stream_with_tools is an async generator, not a coroutine"
    }
  ],
  "new_files": [],
  "deleted_files": []
}
```

**Key rules:**
- Never modifies more than 3 files in a single repair job
- Never touches .env, credentials, DB migrations, or docker-compose.yml
- Always reads the file before writing it
- Always preserves existing patterns and naming conventions
- Every modified file gets a .bak backup before the write

---

### Shield — The QA Engineer

Tests whether Forge's changes actually work. Runs static analysis, imports modified modules, executes smoke tests, and returns a verdict with evidence.

**Model:** llama-3.1-8b-instant (Groq)
**Reason:** Testing is pattern matching, not deep reasoning. Fast model is fine here.

**Tools:**
- run_syntax_check(file) — Python AST parse or TypeScript tsc --noEmit
- run_import_check(module) — attempts to import the module, catches ImportError
- run_smoke_test(test_command) — executes a specific test function
- run_agent_test(agent_name, message) — calls agent.run() and checks it does not crash
- check_routing(message, expected_agents) — validates keyword routing

**Output:**
```json
{
  "verdict": "pass",
  "checks": [
    {"name": "syntax", "status": "pass"},
    {"name": "imports", "status": "pass"},
    {"name": "agent_smoke_test", "status": "pass", "response_preview": "Hi! How can..."},
    {"name": "routing", "status": "pass"}
  ],
  "confidence": 0.92,
  "warnings": ["Token usage increased by 12% — monitor rate limits"]
}
```

**Key rule:** If Shield returns FAIL, the change is never applied. Darwin reports to you. No automatic retry after two failed attempts.

---

### Scroll — The Documentation Agent

Updates documentation when code changes. Keeps the docs honest and current.

**Model:** llama-3.1-8b-instant (Groq)

**Responsibilities:**
- Updates multi_agent_architecture.md when a new agent is created
- Updates the implementation phase checklists
- Writes a "What Changed" entry in the relevant doc
- Never invents capabilities — only documents what was actually built and tested

**Key rule:** Scroll runs last, after Shield confirms the code works.

---

### Sentry — The Monitor

Watches the running system continuously and triggers the IT Department when something goes wrong. This is the entry point for Self-Repair.

**Model:** None — Sentry is rule-based, not an LLM.
**Reason:** A monitor that needs to call an LLM to decide if something is broken is too slow and too expensive. Rules are instant and free.

**Trigger conditions:**

| Condition | Threshold | Action |
|---|---|---|
| Agent error | 3 consecutive failures | Wake Darwin for diagnosis |
| Worker timeout | 1 timeout | Wake Darwin |
| Groq rate limit error | 1 occurrence | Notify user, suggest model switch |
| Import error on startup | 1 occurrence | Wake Darwin immediately |
| DB connection lost | 3 failed queries | Notify user only — not fixable by code |

**Key rule:** Sentry never wakes Darwin for warnings, only errors. Too much noise kills the team effectiveness.

---

## 4. The Two Workflows

### Workflow A — Self-Repair

Triggered automatically by Sentry, or manually by you: "Jazper, something is broken."

```
Step 1: Sentry detects error
        Creates ticket: {error_type, traceback, timestamp, affected_agent}
        Wakes Darwin

Step 2: Darwin reads the ticket
        Assigns to Oracle: "diagnose this"

Step 3: Oracle diagnoses
        Reads the traceback
        Reads the file where the error occurred
        Searches for related code
        Returns: diagnosis report (root cause, file, line, confidence)

Step 4: Darwin reviews confidence
        Below 0.70 → escalate to user: "I need your help with this"
        0.70 or above → assign to Forge: "fix this"

Step 5: Forge writes the fix
        Reads the file first
        Writes a minimal targeted diff
        Returns: change set

Step 6: Darwin presents to user
        "Found a bug in hermes_agent.py line 58. Here is what I want to change.
         Approve? [Yes] [No] [View Details]"
        User approves → continue
        User rejects → close ticket

Step 7: Shield tests the fix
        Syntax check, import check, smoke test
        Pass → proceed
        Fail → do NOT apply. Report to user. Close ticket.

Step 8: Apply and notify
        Forge writes the actual files (with .bak backups)
        Scroll updates documentation
        Darwin notifies user: "Fixed. Here is what changed."
        Sentry monitors for recurrence for 48 hours
```

**Human touchpoints:** One — Step 6 approval before anything is written.
**Total agents involved:** Sentry → Darwin → Oracle → Forge → Darwin (present) → Shield → Scroll

---

### Workflow B — Self-Create

Triggered by you: "Jazper, I want a new agent that monitors my Naukri profile views."

```
Step 1: Darwin receives the request
        Asks clarifying questions if needed
        Writes a spec: {agent_name, purpose, tools_needed, schedule, model, keywords}

Step 2: Darwin presents spec to user
        "Here is what I plan to build. Approve? [Yes] [No] [Modify]"
        User approves → continue

Step 3: Forge reads the codebase
        Reads BaseAgent contract
        Reads 2 existing agents as style examples
        Reads the agent registry
        Writes the new agent file

Step 4: Shield tests the new agent
        Syntax check
        Import check
        Smoke test: agent.run() with a simple message
        Routing test: does it route correctly for expected keywords?

Step 5: If tests fail → Forge revises (max 2 attempts)
        Shield re-tests after each revision
        Still failing after 2 → Darwin escalates to user, stops

Step 6: If tests pass → Darwin presents final result
        Shows the new file content
        Shows test results
        "Ready to activate. Approve? [Yes] [No]"

Step 7: If approved → register and activate
        Agent added to registry
        If scheduled → added to scheduler
        Scroll updates multi_agent_architecture.md
        Darwin notifies: "Agent is now live."

Step 8: Sentry monitors the new agent for 48 hours
        Any errors → immediate Self-Repair trigger
```

**Human touchpoints:** Two — spec approval and activation approval.

---

## 5. The Shared Ticket

All agents communicate through a shared job context — the IT Ticket. Darwin creates it, every agent reads and updates it, and it becomes the permanent audit record.

```python
@dataclass
class ITTicket:
    ticket_id: str
    type: str                      # "repair" or "create"
    status: str                    # open | diagnosing | building | testing | awaiting_approval | done | failed
    created_at: datetime

    # Input
    trigger: str                   # error message or user request
    traceback: str | None
    affected_files: list[str]

    # Oracle output
    diagnosis: dict | None         # root_cause, file, line, confidence

    # Forge output
    proposed_changes: list[dict]   # list of diffs
    new_files: list[dict]

    # Shield output
    test_results: dict | None      # pass/fail with evidence

    # Outcome
    applied: bool
    user_approved: bool
    resolution_note: str
```

---

## 6. Safety Controls (Non-Negotiable)

These are hard limits. No agent can override them, even if Darwin decides it would be helpful.

| Control | Rule |
|---|---|
| Human approval | Every change requires explicit approval before being written to disk |
| File scope | Only backend/python/app/ and frontend/src/ |
| Forbidden files | .env, requirements.txt, docker-compose.yml, init.sql, any migration — never touched |
| Max diff size | No repair changes more than 50 lines total across all files |
| No DB schema changes | Schema migrations require human authorship, always |
| No credential access | API keys, OAuth secrets, passwords — never read or written by any IT agent |
| Retry limit | Max 2 attempts per repair. Then escalate and stop. |
| Rollback | Every modified file gets a .bak before writing. One command restores all backups. |
| Audit log | Every action written to it_department_log table with full context |

---

## 7. Technical Prerequisites

These must exist before the IT Department can be built.

### Test Suite (Most Critical)
Shield's value depends on real tests. Without them it can only do syntax/import checks — catches 40% of bugs, not 95%.

Minimum needed:
- One smoke test per agent (does it run without crashing?)
- Routing tests formalised as pytest (16 cases already written — move to pytest)
- One integration test per background worker
- One endpoint test per API route

### Structured Error Store
Sentry needs structured errors, not just log lines:
```python
await error_store.record(
    agent=self.name,
    error=str(e),
    traceback=traceback.format_exc(),
    context={"task": task, "session_id": session_id},
)
```

### File System Tools
Forge needs safe controlled read/write:
```python
def read_codebase_file(relative_path: str) -> str
def write_codebase_diff(relative_path: str, old: str, new: str) -> bool
def create_codebase_file(relative_path: str, content: str) -> bool
def backup_file(relative_path: str) -> str
```

### IT Department DB Table
```sql
CREATE TABLE it_department_log (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    ticket_id UUID NOT NULL,
    type TEXT NOT NULL,
    trigger_text TEXT,
    diagnosis JSONB,
    proposed_changes JSONB,
    test_results JSONB,
    user_approved BOOLEAN,
    applied BOOLEAN DEFAULT FALSE,
    resolution_note TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    resolved_at TIMESTAMPTZ
);
```

---

## 8. Model Strategy

| Agent | Model | Groq Daily Limit |
|---|---|---|
| Darwin | llama-3.3-70b-versatile | 100k tokens/day |
| Oracle | llama-3.3-70b-versatile | 100k tokens/day |
| Forge | llama-3.3-70b-versatile | 100k tokens/day |
| Shield | llama-3.1-8b-instant | 500k tokens/day |
| Scroll | llama-3.1-8b-instant | 500k tokens/day |
| Sentry | Rule-based — no LLM | N/A |

**Cost per operation on Groq free tier:**
- Simple repair: ~3,000–5,000 tokens (70B calls)
- New agent creation: ~8,000–15,000 tokens (multiple 70B calls)

**Free tier capacity:** 20–30 repairs per day, 6–12 creations per day. More than enough for personal use.

If heavily used, switch Darwin and Oracle to Groq paid tier at $0.59 per million tokens. Or use a local DeepSeek Coder model for Forge (code generation does not require cloud quality at this codebase size).

---

## 9. What It Feels Like in Practice

**Self-Repair at 3 AM:**
```
Sentry:  HermesAgent failed 3 times in a row.
Darwin:  Ticket created. Waking Oracle.
Oracle:  Root cause — missing timeout on Gmail API call, line 94, hermes_agent.py.
         Confidence: 0.92.
Darwin:  [Push notification on your phone]
         "Hermes is down. I want to add a 10-second timeout to Gmail calls.
          Approve fix? [Yes] [No] [View Details]"
You:     Yes (or ignore until morning — system will wait)
Shield:  All tests pass.
Darwin:  "Fixed and deployed. Hermes is healthy.
          Added 10s timeout to Gmail API call in hermes_agent.py line 94."
```

**Self-Create during the day:**
```
You:    "Jazper, I want an agent that monitors my Naukri profile views
         and tells me when a recruiter from a new company looks at me."

Darwin: "I will build a NaukriMonitorAgent that runs every 4 hours.
         It will use Phantom to scrape your Naukri dashboard
         and notify you when a company you have not seen before views you.
         Should it also give you a daily view count summary?
         Approve this plan? [Yes] [No] [Modify]"

You:    "Yes, and include the daily count."

Darwin: "Updated. Building now."

[4 minutes later]

Darwin: "NaukriMonitorAgent is built and passes all tests.
         Here is the file it created: [link]
         Here are the test results: syntax OK, imports OK, smoke test OK.
         Ready to activate? [Yes] [No]"

You:    Yes

Darwin: "NaukriMonitorAgent is now live. First check runs in 4 hours."
```

---

## 10. Implementation Roadmap

### Stage 0 — Prerequisites (Build these first)
- [ ] Formalise routing tests as pytest suite
- [ ] Add one smoke test per agent
- [ ] Create structured error store (append to log_buffer, persist to DB)
- [ ] Create it_department_log table in init.sql
- [ ] Build file system tools module (read/write/backup with path validation)

### Stage 1 — IT Department v1: Repair Only
- [ ] SentryWorker integrated into the existing scheduler
- [ ] DarwinAgent — repair workflow only
- [ ] OracleAgent — log reading + file reading + diagnosis
- [ ] ForgeAgent — diff writing only, no new file creation
- [ ] ShieldAgent — syntax + import + smoke test
- [ ] Approval notification in frontend (new notification type: "approval_required")
- [ ] Approval UI: [Approve] [Reject] [View Diff] buttons in Notifications panel
- [ ] Full end-to-end test with a deliberately introduced bug

### Stage 2 — IT Department v2: Create
- [ ] Extend Darwin with create workflow and spec generation
- [ ] Extend Forge with new file creation from BaseAgent template
- [ ] Extend Shield with new-agent test suite
- [ ] ScrollAgent — updates multi_agent_architecture.md automatically
- [ ] Test: create a simple new agent end-to-end

### Stage 3 — IT Department v3: Autonomous (Long Term)
- [ ] Skip human approval for trivial repairs (missing imports, syntax typos)
- [ ] Sage recalls previous tickets — similar error = faster diagnosis
- [ ] Parallel Oracle hypotheses (two diagnoses simultaneously, Darwin picks the better one)
- [ ] Local code model for Forge when 70B daily limit is exhausted

---

## 11. Why This Approach (vs Simpler Alternatives)

**Why not just have one "DevAgent" that does everything?**

Because diagnosis, writing, and testing require different cognitive modes. A model asked to both find the bug AND fix it will often jump to a fix before fully understanding the problem — this is exactly what junior developers do. Separating Oracle and Forge forces the diagnosis to be complete before any code is written.

**Why not use Claude Code / Devin / Cursor for this?**

Those are external tools. The IT Department is internal to Jazper — it knows your codebase, your patterns, your preferences stored in Sage, and the full context of your system. An external tool starts from zero every time. The IT Department builds knowledge over time.

**Why keep human approval forever?**

Because the cost of a wrong automated change (broken feature in production, accidental data loss) is much higher than the cost of a 30-second approval tap. The goal is to make human oversight frictionless, not to remove it. As trust builds through Stage 1 and 2, Stage 3 can safely skip approval for trivial, well-understood fix patterns.

---

## 12. The Bigger Picture

Once fully built, the operational model becomes:

```
Current state:
  Error occurs → you debug → you fix → you deploy
  New need arises → you design → you build → you test → you deploy

Future state:
  Error occurs → Sentry detects → IT Department diagnoses and fixes → you approve
  New need arises → you describe → IT Department designs, builds, tests → you approve
  Sage remembers all past repairs → similar errors fixed faster next time
  System genuinely improves from operational experience
```

This is not autonomous AI replacing the developer. The human remains in the loop at every consequential decision. What changes is where your attention goes — from implementation details to product direction.

You decide what Jazper should become. The IT Department handles making it happen.
