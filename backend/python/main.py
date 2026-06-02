from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
import structlog
import structlog.dev
import structlog.stdlib
import structlog.processors
from collections import deque
import datetime

from app.routes import chat, memory, health, tasks, ws, models, voice, history, logs as logs_route, dashboard as dashboard_route, notifications as notifications_route
from app.routes import jobs as jobs_route
from app.routes import google as google_route
from app.routes import apply as apply_route
from app.routes import profile as profile_route
from app.core.config import settings

# ── In-memory log ring buffer (last 500 entries) ─────────────────────────────
log_buffer: deque = deque(maxlen=500)
log_subscribers: list = []   # SSE queues


class _BufferProcessor:
    """structlog processor that appends to log_buffer and notifies SSE subscribers."""
    def __call__(self, logger, method, event_dict):
        entry = {
            "level": method,
            "message": event_dict.get("event", ""),
            "timestamp": datetime.datetime.utcnow().isoformat() + "Z",
            "extra": {k: v for k, v in event_dict.items() if k not in ("event", "timestamp", "_record")},
        }
        log_buffer.append(entry)
        dead = []
        for q in log_subscribers:
            try:
                q.put_nowait(entry)
            except Exception:
                dead.append(q)
        for q in dead:
            try:
                log_subscribers.remove(q)
            except ValueError:
                pass
        return event_dict


structlog.configure(
    processors=[
        _BufferProcessor(),
        structlog.stdlib.add_log_level,
        structlog.dev.ConsoleRenderer(),
    ],
    wrapper_class=structlog.stdlib.BoundLogger,
    context_class=dict,
    logger_factory=structlog.PrintLoggerFactory(),
)

log = structlog.get_logger()


def _ensure_tables():
    import psycopg2
    from app.core.config import settings as s
    try:
        conn = psycopg2.connect(
            host=s.POSTGRES_HOST, port=s.POSTGRES_PORT,
            user=s.POSTGRES_USER, password=s.POSTGRES_PASSWORD, dbname=s.POSTGRES_DB,
        )
        cur = conn.cursor()
        cur.execute('CREATE EXTENSION IF NOT EXISTS "uuid-ossp";')
        cur.execute('CREATE EXTENSION IF NOT EXISTS vector;')
        conn.commit()

        # ── Existing tables ───────────────────────────────────────────────────
        cur.execute("""
            CREATE TABLE IF NOT EXISTS core_memories (
                id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
                content TEXT NOT NULL,
                created_at TIMESTAMPTZ DEFAULT NOW(),
                updated_at TIMESTAMPTZ DEFAULT NOW()
            );
            CREATE TABLE IF NOT EXISTS extracted_memories (
                id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
                content TEXT NOT NULL,
                session_id TEXT,
                embedding VECTOR(384),
                created_at TIMESTAMPTZ DEFAULT NOW()
            );
            CREATE TABLE IF NOT EXISTS semantic_memories (
                id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
                content TEXT NOT NULL,
                embedding VECTOR(384),
                metadata JSONB DEFAULT '{}',
                created_at TIMESTAMPTZ DEFAULT NOW()
            );
            CREATE INDEX IF NOT EXISTS idx_semantic_emb
                ON semantic_memories USING ivfflat (embedding vector_cosine_ops)
                WITH (lists = 50);
            CREATE INDEX IF NOT EXISTS idx_extracted_emb
                ON extracted_memories USING ivfflat (embedding vector_cosine_ops)
                WITH (lists = 50);
            CREATE TABLE IF NOT EXISTS chat_sessions (
                id UUID PRIMARY KEY,
                title TEXT NOT NULL DEFAULT 'New Chat',
                expires_at TIMESTAMPTZ DEFAULT NULL,
                created_at TIMESTAMPTZ DEFAULT NOW(),
                updated_at TIMESTAMPTZ DEFAULT NOW()
            );
            ALTER TABLE chat_sessions ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ DEFAULT NULL;
            CREATE TABLE IF NOT EXISTS chat_messages (
                id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
                session_id UUID REFERENCES chat_sessions(id) ON DELETE CASCADE,
                role TEXT NOT NULL,
                content TEXT NOT NULL,
                meta JSONB DEFAULT '{}',
                created_at TIMESTAMPTZ DEFAULT NOW()
            );
            CREATE INDEX IF NOT EXISTS idx_chat_messages_session ON chat_messages(session_id);
        """)
        conn.commit()

        # ── Cron / worker tables ──────────────────────────────────────────────
        cur.execute("""
            CREATE TABLE IF NOT EXISTS cron_jobs (
                id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
                name TEXT NOT NULL,
                worker_type TEXT NOT NULL,
                schedule TEXT NOT NULL,
                enabled BOOLEAN DEFAULT TRUE,
                config JSONB DEFAULT '{}',
                created_at TIMESTAMPTZ DEFAULT NOW(),
                updated_at TIMESTAMPTZ DEFAULT NOW()
            );

            CREATE TABLE IF NOT EXISTS job_runs (
                id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
                cron_job_id UUID REFERENCES cron_jobs(id) ON DELETE CASCADE,
                status TEXT NOT NULL DEFAULT 'pending',
                started_at TIMESTAMPTZ DEFAULT NOW(),
                finished_at TIMESTAMPTZ,
                result JSONB DEFAULT '{}',
                log TEXT DEFAULT ''
            );
            CREATE INDEX IF NOT EXISTS idx_job_runs_cron_job ON job_runs(cron_job_id);
            CREATE INDEX IF NOT EXISTS idx_job_runs_started ON job_runs(started_at DESC);

            CREATE TABLE IF NOT EXISTS credentials (
                portal TEXT PRIMARY KEY,
                token_data JSONB NOT NULL,
                created_at TIMESTAMPTZ DEFAULT NOW(),
                updated_at TIMESTAMPTZ DEFAULT NOW()
            );

            CREATE TABLE IF NOT EXISTS user_profile (
                id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
                full_name TEXT DEFAULT '',
                email TEXT DEFAULT '',
                phone TEXT DEFAULT '',
                resume_text TEXT DEFAULT '',
                skills TEXT[] DEFAULT '{}',
                preferences JSONB DEFAULT '{}',
                created_at TIMESTAMPTZ DEFAULT NOW(),
                updated_at TIMESTAMPTZ DEFAULT NOW()
            );

            CREATE TABLE IF NOT EXISTS gmail_tokens (
                email TEXT PRIMARY KEY,
                token_data JSONB NOT NULL,
                created_at TIMESTAMPTZ DEFAULT NOW(),
                updated_at TIMESTAMPTZ DEFAULT NOW()
            );

            CREATE TABLE IF NOT EXISTS notifications (
                id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
                title TEXT NOT NULL,
                body TEXT DEFAULT '',
                type TEXT NOT NULL DEFAULT 'info',
                read BOOLEAN DEFAULT FALSE,
                created_at TIMESTAMPTZ DEFAULT NOW(),
                job_run_id UUID REFERENCES job_runs(id) ON DELETE SET NULL
            );
            CREATE INDEX IF NOT EXISTS idx_notifications_read ON notifications(read);

            CREATE TABLE IF NOT EXISTS tasks (
                id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
                title TEXT NOT NULL,
                notes TEXT DEFAULT '',
                priority TEXT NOT NULL DEFAULT 'medium',
                status TEXT NOT NULL DEFAULT 'pending',
                due_at TIMESTAMPTZ DEFAULT NULL,
                created_at TIMESTAMPTZ DEFAULT NOW(),
                updated_at TIMESTAMPTZ DEFAULT NOW()
            );
            CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
            CREATE INDEX IF NOT EXISTS idx_tasks_due ON tasks(due_at);
        """)
        conn.commit()

        # ── Job-apply tables ──────────────────────────────────────────────────
        cur.execute("""
            CREATE TABLE IF NOT EXISTS job_apply_profile (
                id SERIAL PRIMARY KEY,
                target_roles TEXT[] DEFAULT '{}',
                work_modes TEXT[] DEFAULT '{remote}',
                locations TEXT[] DEFAULT '{}',
                salary_min INTEGER DEFAULT 0,
                salary_max INTEGER DEFAULT 0,
                experience_years INTEGER DEFAULT 0,
                skills TEXT[] DEFAULT '{}',
                blacklist_companies TEXT[] DEFAULT '{}',
                resume_path TEXT DEFAULT '',
                daily_limit INTEGER DEFAULT 5,
                auto_apply_enabled BOOLEAN DEFAULT FALSE,
                auto_apply_hour INTEGER DEFAULT 9,
                linkedin_email TEXT DEFAULT '',
                chrome_profile_path TEXT DEFAULT '',
                updated_at TIMESTAMPTZ DEFAULT NOW()
            );

            CREATE TABLE IF NOT EXISTS job_screening_answers (
                id SERIAL PRIMARY KEY,
                question TEXT NOT NULL,
                answer TEXT NOT NULL,
                category TEXT DEFAULT 'general',
                updated_at TIMESTAMPTZ DEFAULT NOW()
            );

            CREATE TABLE IF NOT EXISTS job_cover_letters (
                id SERIAL PRIMARY KEY,
                name TEXT NOT NULL,
                content TEXT NOT NULL,
                is_default BOOLEAN DEFAULT FALSE,
                created_at TIMESTAMPTZ DEFAULT NOW(),
                updated_at TIMESTAMPTZ DEFAULT NOW()
            );

            CREATE TABLE IF NOT EXISTS job_applications (
                id TEXT PRIMARY KEY,
                company TEXT NOT NULL,
                title TEXT NOT NULL,
                url TEXT,
                location TEXT,
                work_mode TEXT,
                status TEXT DEFAULT 'applied',
                applied_at TIMESTAMPTZ DEFAULT NOW(),
                cover_letter_name TEXT,
                easy_apply BOOLEAN DEFAULT TRUE,
                notes TEXT DEFAULT '',
                email_thread_id TEXT,
                run_id INTEGER
            );
            CREATE INDEX IF NOT EXISTS idx_job_apps_status ON job_applications(status);
            CREATE INDEX IF NOT EXISTS idx_job_apps_applied ON job_applications(applied_at DESC);

            CREATE TABLE IF NOT EXISTS job_apply_runs (
                id SERIAL PRIMARY KEY,
                started_at TIMESTAMPTZ DEFAULT NOW(),
                completed_at TIMESTAMPTZ,
                jobs_found INTEGER DEFAULT 0,
                jobs_applied INTEGER DEFAULT 0,
                jobs_skipped INTEGER DEFAULT 0,
                status TEXT DEFAULT 'running',
                error_msg TEXT DEFAULT '',
                run_log TEXT DEFAULT ''
            );
        """)
        conn.commit()

        # ── Semantic memory migrations (safe to re-run) ──────────────────
        for col_sql in [
            "ALTER TABLE extracted_memories ADD COLUMN IF NOT EXISTS embedding VECTOR(384)",
        ]:
            try:
                cur.execute(col_sql)
                conn.commit()
            except Exception:
                conn.rollback()

        # ── user_profile column migrations (safe to re-run) ───────────────
        for col_sql in [
            "ALTER TABLE user_profile ADD COLUMN IF NOT EXISTS location TEXT DEFAULT ''",
            "ALTER TABLE user_profile ADD COLUMN IF NOT EXISTS current_role TEXT DEFAULT ''",
            "ALTER TABLE user_profile ADD COLUMN IF NOT EXISTS experience_years TEXT DEFAULT ''",
            "ALTER TABLE user_profile ADD COLUMN IF NOT EXISTS availability TEXT DEFAULT ''",
            "ALTER TABLE user_profile ADD COLUMN IF NOT EXISTS work_type TEXT DEFAULT ''",
            "ALTER TABLE user_profile ADD COLUMN IF NOT EXISTS salary_expectation TEXT DEFAULT ''",
            "ALTER TABLE user_profile ADD COLUMN IF NOT EXISTS sections JSONB DEFAULT '{}'",
            "INSERT INTO user_profile (id) VALUES (uuid_generate_v4()) ON CONFLICT DO NOTHING",
        ]:
            try:
                cur.execute(col_sql)
                conn.commit()
            except Exception:
                conn.rollback()

        cur.close()
        conn.close()
        log.info("All tables ready")
    except Exception as e:
        log.warning("Could not ensure tables", error=str(e))


@asynccontextmanager
async def lifespan(app: FastAPI):
    log.info("Sir Jazper OS starting", model=settings.AI_MODEL, env=settings.ENV)
    _ensure_tables()

    from app.scheduler.scheduler import start_scheduler, stop_scheduler
    from app.services.linkedin_service import seed_default_screening_answers
    try:
        seed_default_screening_answers()
    except Exception:
        pass
    start_scheduler()

    yield

    stop_scheduler()
    log.info("Sir Jazper OS shutting down")


app = FastAPI(title="Sir Jazper OS", version="1.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.FRONTEND_URL],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Routes
app.include_router(health.router,          prefix="/health",            tags=["health"])
app.include_router(chat.router,            prefix="/api/chat",          tags=["chat"])
app.include_router(tasks.router,           prefix="/api/tasks",         tags=["tasks"])
app.include_router(memory.router,          prefix="/api/memory",        tags=["memory"])
app.include_router(ws.router,              prefix="/ws",                tags=["websocket"])
app.include_router(models.router,          prefix="/api/models",        tags=["models"])
app.include_router(voice.router,           prefix="/api/voice",         tags=["voice"])
app.include_router(history.router,         prefix="/api/history",       tags=["history"])
app.include_router(logs_route.router,      prefix="/api/logs",          tags=["logs"])
app.include_router(jobs_route.router,      prefix="/api/jobs",          tags=["jobs"])
app.include_router(google_route.router,    prefix="/api/google",        tags=["google"])
app.include_router(apply_route.router,     prefix="/api/apply",         tags=["apply"])
app.include_router(profile_route.router,   prefix="/api/profile",       tags=["profile"])
app.include_router(dashboard_route.router,      prefix="/api/dashboard",      tags=["dashboard"])
app.include_router(notifications_route.router, prefix="/api/notifications",  tags=["notifications"])
