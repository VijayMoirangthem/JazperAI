# Sir Jazper OS — Database Design

Single PostgreSQL 16 database with pgvector extension. All tables live here — relational data, vector embeddings, and job scheduler state.

---

## Tables

### Core System

| Table | Purpose | Key Fields |
|-------|---------|-----------|
| `chat_sessions` | Conversation sessions | `id UUID`, `title`, `expires_at` |
| `chat_messages` | Per-turn history | `session_id FK`, `role`, `content`, `meta JSONB` |
| `core_memories` | Always-injected facts | `content` |
| `extracted_memories` | Auto-extracted facts | `content`, `embedding VECTOR(384)`, `session_id` |
| `semantic_memories` | Full conversation vectors | `content`, `embedding VECTOR(384)`, `metadata JSONB` |
| `user_profile` | User identity | `full_name`, `email`, `resume_text`, `skills[]`, `sections JSONB` |
| `tasks` | Task management | `title`, `priority`, `status`, `due_at` |
| `notifications` | Job/event results | `title`, `body`, `type`, `read`, `job_run_id FK` |

### Scheduler

| Table | Purpose |
|-------|---------|
| `cron_jobs` | Job definitions (name, worker_type, schedule, config JSONB) |
| `job_runs` | Execution records (status, result JSONB, log TEXT) |

### Credentials

| Table | Purpose |
|-------|---------|
| `credentials` | Encrypted portal tokens (portal PK) |
| `gmail_tokens` | Gmail OAuth tokens (email PK) |

### Job Apply Pipeline

| Table | Purpose |
|-------|---------|
| `job_apply_profile` | LinkedIn config (roles, skills, blacklist, daily_limit) |
| `job_screening_answers` | Pre-stored form Q&A |
| `job_cover_letters` | Cover letter templates |
| `job_applications` | Applied job records (status tracking) |
| `job_apply_runs` | Apply session logs |

### Phases — Digital Mind Simulation

| Table | Purpose | Key Fields |
|-------|---------|-----------|
| `phases_sessions` | Saved Phases conversations | `id UUID`, `mode` (solo/group), `title`, `personality_ids TEXT[]`, `created_at` |
| `phases_messages` | Messages within a session | `session_id FK`, `role` (user/personality), `personality_id`, `content`, `created_at` |

---

## Vector Indexes

```sql
CREATE INDEX idx_semantic_emb ON semantic_memories
  USING ivfflat (embedding vector_cosine_ops) WITH (lists = 50);

CREATE INDEX idx_extracted_emb ON extracted_memories
  USING ivfflat (embedding vector_cosine_ops) WITH (lists = 50);
```

IVF-flat with 50 lists gives sub-millisecond cosine search at millions of vectors on this hardware.

---

## Migration Strategy

Tables are created/migrated in `app/db/init.py` via `_ensure_tables()`, called on FastAPI startup. All migrations use `CREATE TABLE IF NOT EXISTS` and `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` — safe to re-run on every restart.

No external migration tool (Alembic) is used currently. That becomes worth adding when the schema stabilises and multiple team members are involved.

---

## Redis Usage

| Key Pattern | TTL | Content |
|-------------|-----|---------|
| `session:{id}` | 24h | Last 20 conversation turns (clean user/assistant only) |
| `img:{id}` | 24h | Last image sent in session (base64) |
| `email_ctx:{session_id}` | Session | Resolved email IDs for context references |
| `gmail_list:{email}` | 3min | Gmail message list cache |
| `gmail_body:{msg_id}` | 24h | Gmail message body cache |
| `gmail_profile:{email}` | 10min | Gmail profile cache |
| `agent:{session_id}:{agent_name}` | 1h | Per-agent working memory |
