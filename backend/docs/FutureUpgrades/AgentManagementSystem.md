# Agent Management System — Create Origins OS
## Design Document v3.1

**Last Updated:** 2026-07-09
**Status:** Phase 6C COMPLETE · Phase 6D (DB Change Protocol) next
**Platform:** Create Origins OS (CO OS)

---

## ✅ IMPLEMENTATION STATUS (as of 2026-06-23)

This section is the authoritative record of what is actually built and running.
Update this before starting any new phase so future sessions don't re-derive it from chat history.

### Infrastructure

| Component | Status | Notes |
|---|---|---|
| PostgreSQL (pgvector) | ✅ Running | Docker container `sirjazper-postgres` on port 5433 |
| Redis | ✅ Running | Docker container `sirjazper-redis` on port 6379 |
| MinIO | ✅ Configured | Docker container `sirjazper-minio` on ports 9000/9001. Python service + API routes implemented 2026-06-23. |
| `storage/` folder | ✅ Exists | Root-level: `artifacts/`, `logs/`, `sessions/`, `uploads/` |

### MinIO Object Storage (implemented 2026-06-23)

**Service:** `backend/python/app/services/storage.py`
- Singleton `_StorageClient` — lazy init, fails gracefully if MinIO is offline
- Methods: `upload()`, `upload_file()`, `download()`, `delete()`, `list_objects()`, `presigned_url()`, `presigned_upload_url()`, `direct_url()`, `object_exists()`, `ensure_bucket()`, `health()`
- `ensure_bucket()` called on every FastAPI startup (after `ensure_tables()`)

**API:** `backend/python/app/routes/storage.py` → registered at `/api/storage`

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/storage/health` | MinIO connection check |
| GET | `/api/storage/{prefix}` | List objects in prefix |
| POST | `/api/storage/{prefix}` | Upload file (multipart) |
| GET | `/api/storage/{prefix}/{filename}` | Presigned download URL |
| GET | `/api/storage/presign-upload/{prefix}/{filename}` | Presigned PUT URL for direct browser upload |
| DELETE | `/api/storage/{prefix}/{filename}` | Delete object |

**Bucket layout** (single bucket: `sirjazper`):

| Prefix | Purpose |
|---|---|
| `agent-avatars/` | Custom agent avatar images (future migration from local uploads/) |
| `documents/` | User-uploaded PDFs, research docs, attachments |
| `memories/` | Exported memory snapshots |
| `artifacts/` | Agent output files (code, reports, generated content) |
| `sessions/` | Exported chat session transcripts |
| `voice-cache/` | TTS audio cache files |
| `uploads/` | General user uploads |

**Note on agent avatars:** Custom avatars currently saved to `backend/python/uploads/agent_avatars/{codename}.{ext}` (local filesystem) and served via `FileResponse`. Migration to `agent-avatars/` prefix in MinIO is planned for Phase 6C.

### Database Tables

| Table | Status | Notes |
|---|---|---|
| `chat_sessions` | ✅ | Chat history |
| `chat_messages` | ✅ | Per-session messages |
| `extracted_memories` | ✅ | Memory with pgvector embeddings |
| `tasks` | ✅ | Task list with priority + due_at |
| `job_listings` | ✅ | Job search results |
| `agent_registry` | ✅ | 36 agents seeded (13 active + 23 standby) |
| `departments` | ✅ | 15 departments seeded, `budget_daily_usd = 0` (Groq free tier) |
| `jazper_autonomy` | ✅ | 12 categories seeded (all disabled by default) |
| `jazper_autonomous_actions` | ✅ | Autonomy action log |

### Agent Registry

**36 total agents** seeded in `agent_registry`:

**Active (13):**
| ID | Codename | Department | Level | Model |
|---|---|---|---|---|
| AGT-0001 | Jazper | Executive | L1 | llama-3.3-70b-versatile |
| AGT-0002 | Sage | Intelligence | L2 | llama-3.3-70b-versatile |
| AGT-0003 | Scout | Intelligence | L3 | llama-3.3-70b-versatile |
| AGT-0004 | Lens | Intelligence | L3 | llama-3.3-70b-versatile |
| AGT-0005 | Hermes | Communications | L2 | llama-3.3-70b-versatile |
| AGT-0006 | Voice | Communications | L3 | llama-3.1-8b-instant |
| AGT-0007 | Phantom | Security | L3 | llama-3.1-8b-instant |
| AGT-0008 | Atlas | Operations | L2 | llama-3.3-70b-versatile |
| AGT-0009 | Darwin | IT | L3 | llama-3.3-70b-versatile |
| AGT-0010 | Oracle | IT | L4 | llama-3.3-70b-versatile |
| AGT-0011 | Forge | IT | L4 | llama-3.3-70b-versatile |
| AGT-0012 | Shield | IT | L4 | llama-3.1-8b-instant |
| AGT-0013 | Scroll | IT | L4 | llama-3.1-8b-instant |

**Standby/Planned (23):** AGT-0014 through AGT-0036 across departments: Personal, Marketing, Sales, Finance, HR, Analytics, Research, Relations, Creative. All have system prompts and configurations ready. Activate by setting `status = 'active'` in `agent_registry`.

**All 36 agents have:** built-in `system_prompt`, DiceBear avatar (bottts style, codename seed), Edge-TTS voice, badge color, description, capabilities list, tools list.

### Departments (15 seeded)

Executive, Intelligence, Communications, Operations, IT, Security *(6 active, agents deployed)*
Personal, Marketing, Sales, Finance, HR, Analytics, Research, Relations, Creative *(9 planned, no active agents yet)*

All departments: `budget_daily_usd = 0` (Groq free tier — no dollar cost, limits are RPM/TPM per key).
With 3 Groq API keys: 3× rate limits via automatic round-robin rotation in `AIProvider`.

### Backend API Routes

| Prefix | File | Status |
|---|---|---|
| `/api/agents` | `routes/agents.py` | ✅ Full CRUD + avatar + TTS + departments + autonomy + `/live` (perf fields) + `/communications` |
| `/api/storage` | `routes/storage.py` | ✅ MinIO CRUD (new 2026-06-23) |
| `/api/chat` | `routes/chat.py` | ✅ |
| `/api/memory` | `routes/memory.py` | ✅ |
| `/api/tasks` | `routes/tasks.py` | ✅ |
| `/api/voice` | `routes/voice.py` | ✅ Edge-TTS |
| `/api/roadmap` | `routes/roadmap.py` | ✅ |
| `/api/phases` | `routes/phases.py` | ✅ |
| `/api/plans` | `routes/plans.py` | ✅ |
| `/api/approvals` | `routes/approvals.py` | ✅ |
| `/api/it` | `routes/it_department.py` | ✅ |
| `/api/voice-profile` | `routes/voice_profile.py` | ✅ |
| `/api/jobs` | `routes/jobs.py` | ✅ |
| `/api/apply` | `routes/apply.py` | ✅ |
| `/api/google` | `routes/google.py` | ✅ Gmail OAuth |
| `/api/dashboard` | `routes/dashboard.py` | ✅ |
| `/api/notifications` | `routes/notifications.py` | ✅ |

### Frontend Panels

| Panel | File | Status |
|---|---|---|
| Dashboard | `DashboardPanel.tsx` | ✅ |
| Chat | `ChatPanel.tsx` | ✅ |
| Agent Registry | `AgentsPanel.tsx` | ✅ Full — 3 tabs, ID card modal, avatar editor, voice picker, model picker, autonomy |
| Jobs | `JobsPanel.tsx` | ✅ |
| Job Apply | `JobApplyPanel.tsx` | ✅ |
| Memory | `MemoryPanel.tsx` | ✅ |
| Tasks | `TasksPanel.tsx` | ✅ |
| Observatory | `ObservatoryPanel.tsx` | ✅ |
| Phases | `PhasesPanel.tsx` | ✅ |
| Roadmap | `RoadmapPanel.tsx` | ✅ |
| Plans | `PlansPanel.tsx` | ✅ |
| IT Department | `ITDepartmentPanel.tsx` | ✅ |
| Voice Profile | `VoiceProfilePanel.tsx` | ✅ |
| Command Center | `CommandCenterPanel.tsx` + `CommandCenter3DScene.tsx` | ✅ Phase 6B |

### `AgentsPanel.tsx` Features (completed)

- **Agents tab:** searchable grid, deployed vs planned sections, filter by dept/status, "Planned" toggle
- **Model distribution bar:** shows how many active agents use each Groq model
- **Departments tab:** dept cards with enable/disable toggle, agent chips, Groq free tier notice
- **Autonomy tab:** 12 categories grouped by risk level (low/medium/high), each independently toggled
- **Agent ID card modal** (4 tabs):
  - Overview: description, health score, performance stats, capabilities, tools, direct reports
  - Config: status, model picker (7 Groq models with descriptions), temperature, max tokens, trust tier, built-in system prompt + override
  - Voice: Edge-TTS voice picker (20 voices, 4 language groups), pitch/rate sliders, live speak button
  - Lifecycle: agent ID, version, level, created/updated dates
- **Avatar editor modal** (2 tabs):
  - DiceBear: 5×2 image grid of all 10 styles (live preview images, not text), seed input, randomize
  - Custom upload: drag-drop or file picker → saved to local filesystem
- **Topbar HQ button:** navigates to `command_center` view

---

---

## 0. Naming Convention (Final)

| Entity | Official Name | Also acceptable | Notes |
|---|---|---|---|
| The company | **Create Origins** | CO | Real-world company |
| The platform | **Create Origins OS** | CO OS | Replaces "Sir Jazper OS" |
| The owner / CEO | **Vijay Moirangthem** | VJ | Human. L0. Not an agent. Not AI. |
| The primary AI | **Jazper** | Sir Jazper, Jazper AI | All three refer to the same AI |
| All other agents | Their codenames | Scout, Darwin, Hermes, etc. | Each has a unique sudo name |

**Key rule:** "Sir Jazper", "Jazper", and "Jazper AI" are interchangeable — they all refer to the one Chief of Staff AI. The system should accept all three in voice commands and natural language. There is no separate AI for VJ — he is human, the CEO, L0 authority.

---

## 1. Vision

Create Origins OS is a **self-operating company** where AI agents function as employees of a living organization. Every agent has a defined role, chain of command, performance record, assigned voice, and persistent avatar identity.

VJ (Vijay Moirangthem) sits permanently at L0 — absolute authority. Jazper is his Chief of Staff AI. All departments flow through Jazper. All decisions escalate through Jazper unless Jazper Autonomy Mode grants independent authority over specific categories.

The long-term trajectory:
- Today: supervised autonomy — agents act when asked, stop for approval on big moves
- Phase 7: proactive autonomy — Jazper surfaces insights and takes initiative
- Phase 9: goal-directed autonomy — VJ gives a goal, Jazper runs the plan
- DGX Era: full Jazper — local model fine-tuned on VJ's history, physical world integration

---

## 2. Core Principles

1. **One command chain** — VJ → Jazper → Department Heads → Agents. No agent bypasses this.
2. **Every agent is accountable** — all actions logged with agent ID, timestamp, outcome.
3. **Agents are upgradeable** — model, prompt, tools, temperature changeable without rebuilding.
4. **No agent is indispensable** — any agent can be suspended, replaced, or cloned.
5. **VJ has veto on everything** — no irreversible or external action fires without VJ's awareness.
6. **Departments are independently disableable** — one toggle pauses all workers and routing for that dept.
7. **Every DB write by an agent requires diff preview** — show what changes, then confirm.
8. **Jazper Autonomy is granular** — VJ grants authority per decision category individually. Each has its own ON/OFF.
9. **Each agent has a permanent voice and avatar** — default-set, overridable by VJ at any time.

---

## 3. Organizational Structure

### 3.1 Org Chart

```
╔═══════════════════════════════════════════════════════════╗
║   VIJAY MOIRANGTHEM (VJ)  [CEO / L0]                     ║
║   Human operator — permanent absolute authority           ║
╚══════════════════════════╦════════════════════════════════╝
                           ║
              ╔════════════▼════════════╗
              ║   JAZPER   [AGT-0001]   ║
              ║   Chief of Staff        ║
              ║   Level 1 — Executive   ║
              ║   (aka Sir Jazper,      ║
              ║    Jazper AI)           ║
              ╚════╦══════╦═════╦═══════╝
                   ║      ║     ║
       ┌───────────╩┐ ┌───╩──┐ ┌╩──────────┐
       │INTELLIGENCE│ │COMMS │ │ OPERATIONS│
       │  (Sage L2) │ │(Hrms)│ │ (Atlas L2)│
       └─────┬──────┘ └──┬───┘ └─────┬─────┘
             │           │            │
         Scout L3    Voice L3    Darwin L3
         Lens L3    Phantom L3       │
                                  IT Sub-dept
                                 (Oracle/Forge/
                                  Shield/Scroll L4)
```

### 3.2 Seniority Levels

| Level | Title | Description |
|---|---|---|
| **L0** | CEO | VJ — human. Absolute authority. Overrides everything. |
| **L1** | Chief of Staff | Jazper — sole orchestrator. All routing goes through here. |
| **L2** | Department Head | Manages a department, coordinates L3 agents, reports to Jazper. |
| **L3** | Senior Agent | Executes complex multi-step tasks. Can spawn L4 sub-agents. |
| **L4** | Specialist Agent | Single-purpose. Receives tasks from L3 only. |
| **L5** | Worker Agent | Ephemeral. Created for one job, destroyed when done. |

---

## 4. Multi-Model Strategy

### 4.1 How Multiple Agents Scale Without Slowing Down

With 35 agents, you never run 35 models simultaneously. Each agent call is a stateless HTTP request. At any given moment, only 3-5 agents are actually making API calls — the rest are idle, waiting for their next scheduled trigger.

**The real performance concern is sequential chains**, not concurrent agents:
- Bad: Agent A calls Agent B calls Agent C → latency stacks (3× wait)
- Good: A, B, C run in parallel, results merged → same latency as 1
- The agent_bus architecture already supports parallel spawning

### 4.2 Model Tier Assignment

Each seniority level uses a model calibrated to task complexity:

| Level | Agents | Model tier | Example |
|---|---|---|---|
| L1 | Jazper | Most capable (70B+) | llama-3.3-70b-versatile |
| L2-L3 | Dept heads, seniors | Mid-range (8B-32B) | qwen3-32b, llama-3.1-8b-instant |
| L4-L5 | Specialists, workers | Fastest / cheapest (8B) | llama-3.1-8b-instant |
| IT dept | Oracle, Forge | Code-specialized | Qwen Coder, DeepSeek Coder |

Already partially implemented via the `model` field in agent_registry.

### 4.3 On DGX Spark (Future)

When NVIDIA DGX Spark is available (~$3,000-5,000, 128GB unified memory):
- 1 large model (Llama 3.1 70B or 405B) loaded in VRAM — handles 10+ concurrent requests via batched inference
- 1 fast model (8B) for L3-L5
- 1 code-specialized model (Qwen Coder) for IT dept
- 3 models total, all local, zero API cost, zero data leaving machine
- Switching from Groq to Ollama endpoint = one config change (AIProvider supports this already)
- Fine-tune Jazper on VJ's personal history over time

---

## 5. Jazper Autonomy Mode

### 5.1 Concept

Jazper can be granted authority to make specific categories of decisions independently, without asking VJ each time. This is a **granular, per-category toggle system** — not a single master switch that makes Jazper fully autonomous.

VJ controls each category separately. Revoking any category immediately removes Jazper's authority for that type. Jazper always logs its reasoning for every autonomous action so VJ can review and retroactively veto within 24h.

### 5.2 Autonomy Category Registry

```sql
CREATE TABLE jazper_autonomy (
    category_id  TEXT PRIMARY KEY,
    category     TEXT NOT NULL,
    description  TEXT NOT NULL,
    enabled      BOOLEAN DEFAULT FALSE,
    risk_level   TEXT DEFAULT 'low',    -- 'low', 'medium', 'high'
    enabled_at   TIMESTAMPTZ,
    enabled_by   TEXT DEFAULT 'VJ',
    last_used    TIMESTAMPTZ,
    use_count    INTEGER DEFAULT 0
);
```

### 5.3 Autonomy Categories

| Category ID | What Jazper can decide autonomously | Risk |
|---|---|---|
| `dept_scheduling` | Enable/disable departments based on context (vacation, incident, planned rollout) | Low |
| `agent_standby` | Put individual agents in standby when idle for too long | Low |
| `budget_reallocation` | Shift unused budget between departments (within daily cap) | Low |
| `alert_filtering` | Mute low-signal Scout alerts based on learned relevance | Low |
| `auto_repair` | Approve Darwin's self-repair without confirmation (already partially on) | Low |
| `task_routing` | Override default routing to a better-fit department | Medium |
| `prompt_tuning` | Apply Mentor's suggested prompt improvements to underperforming agents | Medium |
| `schedule_adjustment` | Reschedule agent crons based on VJ's activity patterns | Medium |
| `agent_upgrade` | Upgrade an agent's model tier when performance threshold drops | Medium |
| `outreach_send` | Allow Pitch/Echo to send outreach without per-message approval (within template) | High |
| `financial_action` | Allow Coffer to categorize and log transactions without confirmation | High |
| `external_publish` | Allow Quill/Echo to publish content without final approval | High |

**Low risk** categories are recommended to enable first.
**High risk** categories only when VJ trusts Jazper's judgment in that domain.

### 5.4 Autonomy Reasoning Log

When Jazper makes an autonomous decision, it logs its reasoning for VJ to review:

```sql
CREATE TABLE jazper_autonomous_actions (
    id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    category_id  TEXT NOT NULL,
    action_taken TEXT NOT NULL,
    reasoning    TEXT NOT NULL,
    outcome      TEXT,
    vj_reviewed  BOOLEAN DEFAULT FALSE,
    created_at   TIMESTAMPTZ DEFAULT NOW()
);
```

VJ can retroactively veto and roll back any autonomy action within 24h via the DB change protocol (Section 11).

---

## 6. Agent Identity — Avatar, Voice, and ID Card

### 6.1 Avatar System

**Default: DiceBear "bottts" style** — open source, MIT license, self-hosted via `@dicebear/avatars`.

Each agent's unique avatar is generated from their `codename` as a seed. The face is permanent — upgrades, model changes, and role changes do not change it.

**Avatar customization (3 tiers, all available in AgentManagementPanel):**

| Option | How | When to use |
|---|---|---|
| **DiceBear auto** | Generated from codename seed, "bottts" style | Default |
| **DiceBear manual** | Choose style (bottts, pixel-art, adventurer, lorelei, etc.) + reseed | Variety/personality fit |
| **Custom upload** | Upload any PNG/SVG (64×64–512×512) | Specific face for the agent |

```
Avatar resolution priority:
1. Custom uploaded file at /api/avatars/custom/{codename}  → if exists, use it
2. DiceBear overridden style: /api/avatars/dicebear/{style}/{codename}.svg
3. DiceBear default: /api/avatars/dicebear/bottts/{codename}.svg
```

Custom uploads stored at `backend/uploads/agent_avatars/{codename}.{ext}`.

**Avatar editor in AgentManagementPanel:**
- Click agent avatar → opens avatar editor modal
- Tab 1: DiceBear picker — style dropdown, live preview, regenerate button
- Tab 2: Custom upload — drag-drop or file picker, preview, save
- Saved immediately, reflected everywhere (ID card, Command Center, comms log)

### 6.2 Voice Assignment

Each agent has a default TTS voice matched to their character. VJ can override any agent's voice in AgentManagementPanel.

**Default voice assignments (Edge-TTS):**

| Agent | Default Voice | Character fit |
|---|---|---|
| **Jazper** | `en-US-GuyNeural` | Warm, authoritative, trustworthy |
| **Scout** | `en-US-EricNeural` | Energetic, quick, sharp |
| **Sage** | `en-US-RogerNeural` | Deep, measured, wise |
| **Lens** | `en-US-SteffanNeural` | Precise, observational, neutral |
| **Hermes** | `en-US-ChristopherNeural` | Fast, efficient, professional |
| **Voice** | `en-US-JennyNeural` | Clear, articulate, helpful |
| **Phantom** | `en-US-DavisNeural` | Low, deliberate, controlled |
| **Atlas** | `en-GB-RyanNeural` | Organized, methodical (British) |
| **Darwin** | `en-US-AndrewNeural` | Technical, problem-solver tone |
| **Oracle** | `en-AU-NatashaNeural` | Analytical, crisp, precise |
| **Forge** | `en-US-TonyNeural` | Hands-on, direct, grounded |
| **Shield** | `en-GB-SoniaNeural` | Vigilant, steady, assured |
| **Scroll** | `en-US-JasonNeural` | Organized, clear, documentation-focused |

**Voice customization in AgentManagementPanel:**
- Voice selector dropdown (all Edge-TTS voices, filterable by language/gender)
- Prosody controls: pitch offset (±30%), rate offset (±30%)
- Live preview button: speaks a sample phrase in selected voice/prosody
- "Ask to speak" button on each agent's ID card — speaks a contextual greeting in their voice

Voice config stored in `phases_voice_config` table (already exists), extended with `agent_id` to link to agent_registry.

### 6.3 Full ID Card Schema

```json
{
  "agent_id":   "AGT-0003",
  "name":       "Scout",
  "codename":   "scout",
  "version":    "2.1.0",
  "status":     "active",
  "department": "Intelligence",
  "title":      "Senior Intelligence Agent",
  "level":      3,
  "reports_to": "AGT-0001",

  "model":        "llama-3.3-70b-versatile",
  "temperature":  0.4,
  "max_tokens":   2000,
  "tools_enabled": ["web_search", "brave_search", "tavily"],
  "capabilities":  ["web_research", "topic_monitoring", "news_summarization"],

  "voice_id":      "en-US-EricNeural",
  "voice_prosody": { "pitch": "+5%", "rate": "+8%" },

  "avatar_source":      "dicebear",
  "avatar_style":       "bottts",
  "avatar_seed":        "scout",
  "avatar_custom_path": null,

  "trust_tier": "resident",
  "auto_approve_types":    ["web_search"],
  "requires_approval_for": ["send_email", "post_to_web"],

  "performance": {
    "tasks_completed": 1247,
    "tasks_failed": 18,
    "success_rate": 0.986,
    "health_score": 94
  },

  "lifecycle": {
    "created_at": "2025-11-01T00:00:00Z",
    "last_upgraded": "2026-06-10T12:00:00Z",
    "changelog": [
      { "version": "2.1.0", "date": "2026-06-10", "note": "Upgraded to 70B, added Tavily" }
    ]
  },

  "badge_color":  "#22c55e",
  "avatar_emoji": "🔭",
  "description":  "Intelligence and web research specialist."
}
```

### 6.4 Agent Status Values

| Status | Visual | Meaning |
|---|---|---|
| `active` | Green dot, animated | Fully operational |
| `standby` | Blue dot, static | Deployed but not scheduled |
| `thinking` | Amber pulse | Currently processing |
| `working` | Green spin | Executing tool calls |
| `suspended` | Red dot | Temporarily disabled |
| `deprecated` | Grey, strikethrough | Replaced by newer version |
| `retired` | Grey, archive icon | Permanently decommissioned |

### 6.5 Agent Registry DB Table

```sql
CREATE TABLE agent_registry (
    agent_id               TEXT PRIMARY KEY,
    codename               TEXT UNIQUE NOT NULL,
    name                   TEXT NOT NULL,
    version                TEXT NOT NULL DEFAULT '1.0.0',
    status                 TEXT NOT NULL DEFAULT 'active',
    department             TEXT NOT NULL,
    title                  TEXT NOT NULL,
    level                  INTEGER NOT NULL DEFAULT 3,
    reports_to             TEXT REFERENCES agent_registry(agent_id),
    model                  TEXT NOT NULL,
    temperature            FLOAT DEFAULT 0.5,
    max_tokens             INTEGER DEFAULT 1000,
    tools_enabled          TEXT[] DEFAULT '{}',
    capabilities           TEXT[] DEFAULT '{}',
    system_prompt_override TEXT DEFAULT NULL,
    auto_approve_types     TEXT[] DEFAULT '{}',
    requires_approval_for  TEXT[] DEFAULT '{}',
    trust_tier             TEXT DEFAULT 'citizen',
    voice_id               TEXT DEFAULT 'en-US-GuyNeural',
    voice_prosody          JSONB DEFAULT '{}',
    avatar_source          TEXT DEFAULT 'dicebear',
    avatar_style           TEXT DEFAULT 'bottts',
    avatar_seed            TEXT,
    avatar_custom_path     TEXT DEFAULT NULL,
    avatar_emoji           TEXT DEFAULT '🤖',
    badge_color            TEXT DEFAULT '#94a3b8',
    description            TEXT DEFAULT '',
    meta                   JSONB DEFAULT '{}',
    created_at             TIMESTAMPTZ DEFAULT NOW(),
    updated_at             TIMESTAMPTZ DEFAULT NOW()
);
```

---

## 7. Department Registry

### 7.1 Departments Table

```sql
CREATE TABLE departments (
    id                TEXT PRIMARY KEY,
    name              TEXT NOT NULL,
    description       TEXT DEFAULT '',
    head_agent        TEXT REFERENCES agent_registry(agent_id),
    enabled           BOOLEAN DEFAULT TRUE,
    budget_daily_usd  FLOAT DEFAULT 5.0,
    budget_used_today FLOAT DEFAULT 0.0,
    badge_color       TEXT DEFAULT '#94a3b8',
    floor_position    JSONB DEFAULT '{}',   -- {x, y, w, h} in Command Center SVG
    created_at        TIMESTAMPTZ DEFAULT NOW()
);
```

### 7.2 Disable Department Behavior

When a department is disabled (by VJ directly, or by Jazper if `dept_scheduling` autonomy is ON):
1. All scheduled workers **pause** — do not fire even on schedule
2. Task routing **skips** this department
3. In-progress tasks **complete** — no hard kill mid-execution
4. Budget effectively **$0** — no API calls charged here
5. All agents appear as `standby` in Command Center regardless of individual status
6. Department room in Command Center shows **OFFLINE** overlay

---

## 8. Complete Agent Roster (36 Total)

### 8.1 Built (13 agents)

| ID | Agent | Dept | Level | Status |
|---|---|---|---|---|
| AGT-0001 | Jazper | Executive | L1 | Active |
| AGT-0002 | Sage | Intelligence | L2 (head) | Active |
| AGT-0003 | Scout | Intelligence | L3 | Active |
| AGT-0004 | Lens | Intelligence | L3 | Active |
| AGT-0005 | Hermes | Communications | L2 (head) | Active |
| AGT-0006 | Voice | Communications | L3 | Active |
| AGT-0007 | Phantom | Security (promoted) | L3 | Active |
| AGT-0008 | Atlas | Operations | L2 (head) | Active |
| AGT-0009 | Darwin | Operations / IT | L3 | Active |
| AGT-0010 | Oracle | IT (sub-dept) | L4 | Active |
| AGT-0011 | Forge | IT (sub-dept) | L4 | Active |
| AGT-0012 | Shield | IT (sub-dept) | L4 | Active |
| AGT-0013 | Scroll | IT (sub-dept) | L4 | Active |

### 8.2 Planned (23 agents — Standby, not yet built)

#### Personal Department
| ID | Agent | Role |
|---|---|---|
| AGT-0014 | **Chronos** | Calendar & scheduling — books time, blocks focus windows, reminders |
| AGT-0015 | **Habit** | Health & wellness — tracks patterns, surfaces insights |
| AGT-0016 | **Lore** | Learning curator — reading list, paper/book summaries on request |

#### Marketing Department
| ID | Agent | Role |
|---|---|---|
| AGT-0017 | **Quill** | Content writer — blog posts, LinkedIn articles from bullet notes |
| AGT-0018 | **Echo** | Social media — schedules posts, monitors engagement, drafts replies |
| AGT-0019 | **Beacon** | SEO analyst — keyword research, content gap analysis |
| AGT-0020 | **Pixel** | Design brief writer — detailed visual direction for designers |

#### Sales Department
| ID | Agent | Role |
|---|---|---|
| AGT-0021 | **Hawk** | Lead finder — searches for client prospects matching defined criteria |
| AGT-0022 | **Pitch** | Outreach writer — personalized cold emails and DMs |
| AGT-0023 | **Pipeline** | CRM tracker — contacts, follow-ups, deal stage tracking |

#### Finance Department
| ID | Agent | Role |
|---|---|---|
| AGT-0024 | **Coffer** | Expense tracker — categorizes transactions, weekly summaries |
| AGT-0025 | **Audit** | Cost watcher — API usage per dept, alerts on budget spikes |
| AGT-0026 | **Taxman** | Compliance reminders — tax dates, deduction tracking |

#### HR Department *(manages agents, not humans)*
| ID | Agent | Role |
|---|---|---|
| AGT-0027 | **Warden** | Agent auditor — weekly review of all agent actions, anomaly flags |
| AGT-0028 | **Mentor** | Prompt trainer — improves system prompts for underperforming agents |
| AGT-0029 | **Clerk** | Registry manager — manage agent_registry via natural language |

#### Security Department
| ID | Agent | Role |
|---|---|---|
| *(Phantom)* | **Phantom** (dept head) | Promoted from Communications — Security dept head |
| AGT-0030 | **Sentinel** | Pattern detector — flags unusual agent behavior or external anomalies |

#### Analytics Department
| ID | Agent | Role |
|---|---|---|
| AGT-0031 | **Analyst** | BI agent — queries DB, generates reports and charts |
| AGT-0032 | **Prophet** | Trend forecaster — growth/decline patterns in work and life |

#### Research Department
| ID | Agent | Role |
|---|---|---|
| AGT-0033 | **Compass** | Deep research — multi-source synthesis, not just find-and-list |
| AGT-0034 | **Archivist** | Document manager — indexes local files, makes them searchable |

#### Relations Department
| ID | Agent | Role |
|---|---|---|
| AGT-0035 | **Nexus** | Relationship manager — knows everyone VJ knows, surfaces reconnect signals |

#### Creative Department
| ID | Agent | Role |
|---|---|---|
| AGT-0036 | **Muse** | Ideation partner — brainstorming for products, names, strategy |

---

## 9. Command Center (Visual Mode)

### 9.1 Concept

A live, interactive visualization of the entire Create Origins organization. Every agent visible in their department room. Every real background task shows up as movement. VJ can see the company breathing.

**Entry point:** "HQ" button in the main application topbar → navigates to `command_center` view.
**Panel name:** "Command Center" (this is a control room, not a game — the name should reflect authority)

**Technology stack:**
- Phase 6B (now): React + SVG + CSS animations — no game engine, no canvas library
- Phase 8+ (future): Upgrade to React Three Fiber for proper isometric/3D HQ visualization with 3D character models

### 9.2 Visual Design

```
┌───────────────────── COMMAND CENTER — CREATE ORIGINS HQ ─────────────────────┐
│                                                                               │
│  ┌──────────────┐  ┌─────────────────┐  ┌──────────────┐                   │
│  │  EXECUTIVE   │  │  INTELLIGENCE   │  │    COMMS     │                   │
│  │              │  │                 │  │              │                   │
│  │  [Jazper🤖]  │  │  [Sage📚]       │  │ [Hermes📧]   │                   │
│  │   thinking…  │  │  [Scout🔭] busy  │  │ [Voice🎤]    │                   │
│  │              │  │  [Lens👁️]  idle  │  │ [Phantom🕵️]  │                   │
│  └──────────────┘  └────────┬────────┘  └──────────────┘                   │
│                              │ animated comm arc                             │
│  ┌──────────────┐  ┌─────────▼───────┐  ┌──────────────┐                   │
│  │  OPERATIONS  │  │      IT         │  │  [OFFLINE]   │                   │
│  │              │  │                 │  │  MARKETING   │                   │
│  │ [Atlas📊]    │  │ [Darwin🔧] busy  │  │  ░░░░░░░░░░ │                   │
│  │              │  │ [Oracle🔬]      │  └──────────────┘                   │
│  └──────────────┘  │ [Forge⚙️]  busy  │                                   │
│                    │ [Shield🛡️]       │                                   │
│                    └─────────────────┘                                   │
│                                                                               │
│  Active: 4 · Tasks: 3 · Alerts: 0 · Cost today: $0.04 · Autonomy: ON       │
└───────────────────────────────────────────────────────────────────────────────┘
```

### 9.3 Agent Visual States

| State | Animation | Color signal |
|---|---|---|
| **Idle** | Gentle bob (1s loop) | Neutral |
| **Thinking** | Pulsing thought bubbles | Amber glow |
| **Working** | Tool icon spins above | Green glow |
| **Communicating** | Animated arc to target | Blue arc |
| **Error** | Shake + exclamation | Red |
| **Suspended** | Static, 30% opacity | None |
| **Dept offline** | Whole room greyed + OFFLINE badge | None |

### 9.4 Interactions

- **Click a room** → department detail panel (agents, KPIs, tasks, enable/disable toggle)
- **Click an agent** → full ID card (model, stats, voice picker, avatar editor)
- **Click a comm arc** → message content + subject
- **Hover an agent** → tooltip: current task, last action, health score
- **Right-click an agent** → suspend, view log, ask to speak, send task

### 9.5 Real-Time Data

- Polls `/api/registry/live` every 5 seconds for agent status changes
- WebSocket events push instant updates (task started, completed, error)
- Communication arcs sourced from `agent_communications` table (Section 10.3)

### 9.6 Future 3D Upgrade (Phase 8+)

When upgrading to 3D:
- Replace SVG floor plan with **React Three Fiber** scene
- Departments become isometric building sections
- Agents become animated low-poly 3D character models
- Communication arcs become glowing particle trails between rooms
- Camera can orbit, zoom, drill into departments
- Data layer unchanged — same API, same WebSocket events

---

## 10. Metrics & Reporting

### 10.1 Department Scorecards

Weekly scorecard per department (generated by Warden, HR dept):

| Department | Primary Metric | Secondary Metric | Health Signal |
|---|---|---|---|
| **Executive** | Routing accuracy | Plan completion rate | Approval backlog |
| **Intelligence** | Memory recall precision | Alert signal-to-noise | Knowledge base growth |
| **IT** | Self-repair success rate | MTTR | Test coverage drift |
| **Communications** | Email processing latency | Voice recognition accuracy | Notification click rate |
| **Operations** | Job application conversion | Scheduled task completion | Timeline adherence |
| **Marketing** | Content output vs. plan | Engagement rate | Publishing consistency |
| **Sales** | Leads qualified/week | Outreach reply rate | Pipeline velocity |
| **Finance** | Budget adherence | Cost per successful output | Overspend alerts |
| **HR** | Agent health scores | Prompt improvement success | Incidents resolved |
| **Security** | Anomalies detected | False positive rate | Response time |

### 10.2 Agent Health Score (0–100)

Computed weekly by Warden:

```
Health Score =
  (Success Rate × 40) +
  (Latency Score × 20) +       # 100 - normalized vs. benchmark
  (Error-free Days × 20) +     # clean days / 7
  (Uptime Score × 20)          # active hours / scheduled hours
```

Score bands:
- 90–100: Excellent (green)
- 75–89: Good (light green)
- 60–74: Degraded (amber) → Mentor reviews prompt; if autonomy ON, applies fix
- Below 60: Critical (red) → Warden flags for upgrade or suspension

### 10.3 Inter-Department Communication Log

```sql
CREATE TABLE agent_communications (
    id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    from_agent TEXT NOT NULL REFERENCES agent_registry(codename),
    to_agent   TEXT,           -- NULL = broadcast
    subject    TEXT NOT NULL,
    payload    JSONB DEFAULT '{}',
    status     TEXT DEFAULT 'sent',  -- 'sent', 'received', 'failed'
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX ON agent_communications(from_agent, created_at DESC);
CREATE INDEX ON agent_communications(created_at DESC);
```

Dashboard shows: volume per pair, failed delivery rate, isolated agents (no activity in 7 days), broadcast frequency. Arcs in Command Center SVG are sourced from this table.

### 10.4 Agent Performance Tracking

```sql
CREATE TABLE agent_actions (
    id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    agent_id      TEXT NOT NULL,
    action_type   TEXT NOT NULL,
    outcome       TEXT,
    duration_ms   INTEGER,
    input_tokens  INTEGER DEFAULT 0,
    output_tokens INTEGER DEFAULT 0,
    cost_usd      FLOAT DEFAULT 0,
    error_msg     TEXT DEFAULT '',
    created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE agent_performance_snapshots (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    agent_id        TEXT NOT NULL,
    week_start      DATE NOT NULL,
    tasks_completed INTEGER DEFAULT 0,
    tasks_failed    INTEGER DEFAULT 0,
    avg_duration_ms FLOAT DEFAULT 0,
    total_cost_usd  FLOAT DEFAULT 0,
    health_score    FLOAT DEFAULT 0,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(agent_id, week_start)
);
```

---

## 11. Agent DB Control Protocol

### 11.1 The Write Workflow

```
Agent proposes a DB change
          ↓
System generates DIFF preview shown to VJ:
┌───────────────────────────────────────────────┐
│ Atlas wants to update your Job Apply Profile  │
│                                               │
│  daily_limit:   5 → 10                       │
│  auto_apply:    false → true                 │
│  target_roles:  ["Backend Dev"]              │
│               + ["Product Manager"]          │
│                                               │
│ [Approve]  [Deny]  [Edit before applying]     │
└───────────────────────────────────────────────┘
          ↓ (if approved)
Execute + snapshot before-state to rollback log
          ↓
Log in agent_actions: agent, table, rows, cost, timestamp
          ↓
24-hour rollback window: "Undo this change" available
```

### 11.2 Rollback Table

```sql
CREATE TABLE db_change_log (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    agent_id    TEXT NOT NULL,
    table_name  TEXT NOT NULL,
    operation   TEXT NOT NULL,
    before_data JSONB,
    after_data  JSONB,
    approved_by TEXT DEFAULT 'VJ',
    rolled_back BOOLEAN DEFAULT FALSE,
    expires_at  TIMESTAMPTZ,
    created_at  TIMESTAMPTZ DEFAULT NOW()
);
```

---

## 12. VJ's Control Levers

No matter how autonomous the system becomes:

1. **Kill Switch** — suspend all agents instantly. One button. Immediate effect.
2. **Department Switch** — disable any department independently (workers paused, budget zero)
3. **Veto** — any approval denied at any point. Any plan aborted mid-execution.
4. **Audit Trail** — every action ever taken is logged and searchable. Nothing hidden.
5. **Agent Override** — any agent's model, prompt, temperature, tools, voice, avatar changeable live.
6. **DB Change Undo** — 24-hour rollback on every agent-driven database change.
7. **Org Chart Control** — reporting lines, department structure, all editable.
8. **Budget Limits** — daily API cap per department. Auto-suspend on breach.
9. **Jazper Autonomy Controls** — granular per-category switches (Section 5).
10. **Succession Protocol** — if Jazper (L1) fails, VJ commands department heads directly.

---

## 13. The Jazzer Roadmap

### Stage 1 — Current (Supervised Autonomy)
- Reactive: agents act when asked
- Scheduled: digests, monitoring, repairs run on timers
- Approval-gated: irreversible actions pause for VJ
- Self-healing: Darwin handles errors automatically

### Stage 2 — Phase 7 (Proactive Intelligence)
- Morning brief: Jazper synthesizes email + calendar + news → TTS at 7am
- Pattern detection: Sage surfaces "haven't touched portfolio in 3 weeks"
- Opportunity flagging: Scout finds relevant conference, Jazper briefs unprompted
- Jazper Autonomy low-risk categories activated

### Stage 3 — Phase 9 (Goal-Directed)
- VJ gives a goal: "Land 3 clients this month"
- Jazper breaks it down, assigns departments, tracks weekly
- Course correction: if Pitch gets 0 replies in week 2, Mentor rewrites the template (autonomy)
- HR dept actively managing agent performance

### Stage 4 — DGX Spark Era (Full Jazper)
- Jazper fine-tuned on 2+ years of VJ's decisions and preferences
- Physical world: smart home, calendar sync, wearables
- Vision: reads VJ's screen, understands context without being told
- Real-time cross-domain synthesis
- No API costs, no rate limits, no cloud dependency

---

## 14. Implementation Roadmap

### Phase 6A — Agent Registry ✅ COMPLETE
- [x] `agent_registry` + `departments` tables seeded — 36 agents (13 active + 23 standby), 15 departments
- [x] `GET /api/agents/` — all agents with stats + avatar URLs
- [x] `GET /api/agents/{agent_id}` — full ID card with direct reports
- [x] `PATCH /api/agents/{agent_id}` — update model, system_prompt, voice, avatar, status, etc.
- [x] `POST /api/agents/` — deploy new agent
- [x] `GET/PATCH /api/agents/departments/` — list + enable/disable departments
- [x] `GET/PATCH /api/agents/autonomy/` — list + toggle Jazper autonomy categories
- [x] DiceBear avatar via CDN (`https://api.dicebear.com/7.x/{style}/svg?seed={codename}`)
- [x] Custom avatar upload (`POST /api/agents/avatars/{codename}`) → local filesystem
- [x] `POST /api/agents/{agent_id}/speak` — TTS via Edge-TTS, per-agent voice + prosody
- [x] `AgentsPanel.tsx` — 3 tabs, ID card modal, avatar editor (image grid), voice picker, model picker, autonomy toggle
- [x] `jazper_autonomy` table seeded with 12 categories (all disabled, ready to toggle)
- [x] All 36 agents have built-in `system_prompt` stored in DB
- [x] Topbar HQ button navigates to `command_center` view
- [x] MinIO service + `/api/storage` routes (infrastructure for Phase 6C+)

### Phase 6B — Command Center ✅ COMPLETE
- [x] `CommandCenterPanel.tsx` — React Three Fiber 3D floor plan with 15 department rooms
- [x] Agent spheres with badge-color emissive materials per room; `agentSlots()` grid placement
- [x] State animations: idle bob (1s), working pulse + scale (3.8Hz), emissive intensity per state
- [x] `CommArcs` + `CommArc` — bezier curves between dept rooms; animated traveling dot, polls `/api/agents/communications` every 15s
- [x] Real-time polling every 30s from `/api/agents/live`; WebSocket singleton for AGENT_STATUS push
- [x] Click interactions: room floor → Dept detail sidebar (spring animation); agent sphere → Agent detail sidebar
- [x] `agentStore.ts` — Zustand store with `fetchLive`, `setRuntimeStatus`, `toggleDept`
- [x] `DeptDetailPanel` — agent list, active count, enable/disable toggle
- [x] `AgentDetailPanel` — animated avatar, level/health/dept/ID stats, "Open full profile" link

### Phase 6C — Performance & Metrics ✅ COMPLETE
- [x] `agent_communications`, `agent_actions`, `agent_performance_snapshots` tables (in `db/init.py`)
- [x] `agent_bus.publish()` persists every message to `agent_communications` (fire-and-forget thread)
- [x] `GET /api/agents/communications` — recent comms for comm arc rendering (last N minutes)
- [x] `GET /api/agents/live` now includes `tasks_completed`, `tasks_failed`, `last_active` per agent
- [x] `_record_agent_run()` fixed (was hitting non-existent `agents` table → now `agent_registry`); also inserts to `agent_actions` with duration_ms + token counts
- [x] `WardenWorker` (`app/workers/warden_worker.py`) — weekly health scan, writes `agent_performance_snapshots`, pushes notifications for critical/degraded agents
- [x] Warden registered in APScheduler — Sunday 02:30 UTC
- [ ] Migrate custom avatar storage from local filesystem → MinIO `agent-avatars/` prefix *(deferred to 6F)*
- [ ] Department scorecard panel using `agent_performance_snapshots` *(deferred to 6F)*

### Phase 6D — DB Change Protocol
- [ ] `db_change_log` table
- [ ] Diff preview component: agent proposes a DB write → VJ sees diff → approves/rejects
- [ ] 24-hour rollback UI for any agent-initiated write
- [ ] Integration with existing approval system (`/api/approvals`)

### Phase 6E — Jazper Autonomy Logging Panel *(already toggleable, need log viewer)*
- [ ] `jazper_autonomous_actions` log panel in AgentsPanel Autonomy tab
- [ ] VJ reviews Jazper's decisions, can mark reviewed + retroactively veto
- [ ] Autonomy usage stats surfaced in Company Dashboard

### Phase 6F — Company Dashboard
- [ ] Top-level KPIs: active agents, tasks today, cost today (requests used vs cap), alerts
- [ ] Per-department scorecard (health avg, tasks completed, active/standby agents)
- [ ] Model distribution and request usage (Audit agent feeds this)
- [ ] Master kill switch + department toggles in one panel

### Phase 7 — Proactive Intelligence
- [ ] Morning brief: Jazper synthesises overnight intelligence + delivers via TTS at configured time
- [ ] Pattern detection (Sage extended): surface recurring themes across memories
- [ ] Scout alert smart-filtering using `alert_filtering` autonomy category

### Phase 8 — Full Department Activation
- [ ] Marketing: Quill + Echo + Beacon + Pixel connected to real tools (social APIs, scheduler)
- [ ] Sales: Hawk + Pitch + Pipeline connected to Apollo/Hunter, email sending via Hermes
- [ ] HR: Warden cron running weekly, Mentor improvement loop with VJ approval gate
- [ ] Finance: Coffer + Audit expense parsing, Audit monitoring Groq API usage
- [ ] Document storage: Compass + Archivist using MinIO `documents/` + `artifacts/` prefixes

### Phase 8+ — 3D Command Center Upgrade
- [ ] React Three Fiber scene replacing SVG floor plan
- [ ] Isometric building sections per department
- [ ] Low-poly agent 3D character models (or DiceBear billboard sprites)
- [ ] Particle trail communication arcs
- [ ] Camera orbit/zoom/drill-down interactions

### DGX Spark Era
- [ ] Ollama endpoint swap in AIProvider (one config change from Groq)
- [ ] Per-department-head model assignment (Jazper gets 70B+, L4s get 8B)
- [ ] Jazper fine-tuning pipeline on VJ's decision history
- [ ] Vision model integration (screen reading, Lens agent fully operational)
- [ ] Zero API cost, zero cloud dependency, no rate limits

---

*This document is the master design reference for the Agent Management System.
Per-phase implementation details live in `docs/Phases/`.
Agent configurations live in the `agent_registry` DB table — source of truth after Phase 6A.
3D Command Center design to be detailed in `docs/FutureUpgrades/CommandCenter3D.md` when Phase 8+ begins.
**Always update the Implementation Status section (top of this doc) before starting a new session or phase.**
*
