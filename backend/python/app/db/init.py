"""Database initialisation — runs on startup, safe to re-run on every restart."""

import structlog

log = structlog.get_logger()


def ensure_tables() -> None:
    import psycopg2
    from app.core.config import settings as s

    try:
        conn = psycopg2.connect(
            host=s.POSTGRES_HOST, port=s.POSTGRES_PORT,
            user=s.POSTGRES_USER, password=s.POSTGRES_PASSWORD, dbname=s.POSTGRES_DB,
        )
        cur = conn.cursor()

        # ── Extensions ────────────────────────────────────────────────────────
        cur.execute('CREATE EXTENSION IF NOT EXISTS "uuid-ossp";')
        cur.execute('CREATE EXTENSION IF NOT EXISTS vector;')
        conn.commit()

        # ── Early column migrations (must exist before table bodies below) ────
        for sql in [
            "ALTER TABLE extracted_memories ADD COLUMN IF NOT EXISTS embedding VECTOR(384)",
            "ALTER TABLE chat_sessions      ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ DEFAULT NULL",
            "ALTER TABLE tasks              ADD COLUMN IF NOT EXISTS notes    TEXT    DEFAULT ''",
            "ALTER TABLE tasks              ADD COLUMN IF NOT EXISTS priority TEXT    NOT NULL DEFAULT 'medium'",
            "ALTER TABLE tasks              ADD COLUMN IF NOT EXISTS due_at   TIMESTAMPTZ DEFAULT NULL",
            "ALTER TABLE agent_registry     ADD COLUMN IF NOT EXISTS system_prompt TEXT DEFAULT ''",
            "ALTER TABLE agent_registry     ADD COLUMN IF NOT EXISTS last_active TIMESTAMPTZ DEFAULT NULL",
            "ALTER TABLE user_profile       ADD COLUMN IF NOT EXISTS resume_filename   TEXT DEFAULT NULL",
            "ALTER TABLE user_profile       ADD COLUMN IF NOT EXISTS resume_updated_at TIMESTAMPTZ DEFAULT NULL",
            "ALTER TABLE job_applications   ADD COLUMN IF NOT EXISTS cover_letter TEXT DEFAULT NULL",
            "ALTER TABLE notifications      ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'",
            "ALTER TABLE habits ADD COLUMN IF NOT EXISTS emoji TEXT DEFAULT '✅'",
            "ALTER TABLE job_radar_items ADD COLUMN IF NOT EXISTS relevance FLOAT DEFAULT 0.5",
            "ALTER TABLE voice_journal ADD COLUMN IF NOT EXISTS duration_seconds FLOAT DEFAULT 0",
            "ALTER TABLE response_templates ADD COLUMN IF NOT EXISTS category TEXT DEFAULT 'custom'",
            "ALTER TABLE contacts ADD COLUMN IF NOT EXISTS outreach_status TEXT DEFAULT 'none'",
            "ALTER TABLE contacts ADD COLUMN IF NOT EXISTS outreach_notes TEXT DEFAULT ''",
            "ALTER TABLE contacts ADD COLUMN IF NOT EXISTS outreach_at TIMESTAMPTZ DEFAULT NULL",
            "ALTER TABLE agent_registry ADD COLUMN IF NOT EXISTS team_id TEXT DEFAULT NULL",
            "ALTER TABLE agent_registry ADD COLUMN IF NOT EXISTS floor_id TEXT DEFAULT NULL",
            "ALTER TABLE agent_registry ADD COLUMN IF NOT EXISTS desk_slot INTEGER DEFAULT NULL",
            "ALTER TABLE departments ADD COLUMN IF NOT EXISTS division_id TEXT DEFAULT NULL",
            "ALTER TABLE departments ADD COLUMN IF NOT EXISTS floor_id TEXT DEFAULT NULL",
        ]:
            try:
                cur.execute(sql)
                conn.commit()
            except Exception:
                conn.rollback()

        # ── Core memory + chat tables ─────────────────────────────────────────
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

        # ── Scheduler + credential + task tables ──────────────────────────────
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
            CREATE INDEX IF NOT EXISTS idx_job_runs_started  ON job_runs(started_at DESC);

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
            CREATE INDEX IF NOT EXISTS idx_tasks_due    ON tasks(due_at);
        """)
        conn.commit()

        # ── Habit tracker tables ──────────────────────────────────────────────
        cur.execute("""
            CREATE TABLE IF NOT EXISTS habits (
                id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
                title TEXT NOT NULL,
                emoji TEXT DEFAULT '✅',
                created_at TIMESTAMPTZ DEFAULT NOW()
            );

            CREATE TABLE IF NOT EXISTS habit_completions (
                id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
                habit_id UUID REFERENCES habits(id) ON DELETE CASCADE,
                completed_date DATE NOT NULL,
                UNIQUE(habit_id, completed_date)
            );
        """)
        conn.commit()

        # ── Job Radar ─────────────────────────────────────────────────────────
        cur.execute("""
            CREATE TABLE IF NOT EXISTS job_radar_items (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                title TEXT NOT NULL,
                company TEXT DEFAULT '',
                location TEXT DEFAULT '',
                url TEXT DEFAULT '',
                relevance FLOAT DEFAULT 0.5,
                status TEXT DEFAULT 'new',
                matched_at TIMESTAMPTZ DEFAULT NOW()
            );
        """)
        conn.commit()

        # ── Phase 18 — Voice Journal, Response Templates, Reminders ─────────
        cur.execute("""
            CREATE TABLE IF NOT EXISTS voice_journal (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                transcription TEXT NOT NULL DEFAULT '',
                duration_seconds FLOAT DEFAULT 0,
                created_at TIMESTAMPTZ DEFAULT NOW()
            );

            CREATE TABLE IF NOT EXISTS response_templates (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                name TEXT NOT NULL,
                category TEXT DEFAULT 'custom',
                body TEXT NOT NULL DEFAULT '',
                created_at TIMESTAMPTZ DEFAULT NOW()
            );

            CREATE TABLE IF NOT EXISTS reminders (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                title TEXT NOT NULL,
                body TEXT DEFAULT '',
                remind_at TIMESTAMPTZ NOT NULL,
                related_type TEXT DEFAULT '',
                related_id TEXT DEFAULT '',
                status TEXT DEFAULT 'pending',
                created_at TIMESTAMPTZ DEFAULT NOW()
            );
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
            CREATE INDEX IF NOT EXISTS idx_job_apps_status  ON job_applications(status);
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

        # ── Phases — Digital Mind Simulation ──────────────────────────────────
        cur.execute("""
            CREATE TABLE IF NOT EXISTS phases_sessions (
                id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
                title TEXT NOT NULL DEFAULT 'Phases Session',
                mode TEXT NOT NULL DEFAULT 'solo',
                personality_ids TEXT[] DEFAULT '{}',
                created_at TIMESTAMPTZ DEFAULT NOW(),
                updated_at TIMESTAMPTZ DEFAULT NOW()
            );
            CREATE TABLE IF NOT EXISTS phases_messages (
                id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
                session_id UUID REFERENCES phases_sessions(id) ON DELETE CASCADE,
                role TEXT NOT NULL,
                personality_id TEXT DEFAULT NULL,
                personality_name TEXT DEFAULT NULL,
                personality_emoji TEXT DEFAULT NULL,
                content TEXT NOT NULL,
                created_at TIMESTAMPTZ DEFAULT NOW()
            );
            CREATE INDEX IF NOT EXISTS idx_phases_messages_session ON phases_messages(session_id);
        """)
        conn.commit()

        # ── IT Department — Phase 5 tables ───────────────────────────────────
        cur.execute("""
            CREATE TABLE IF NOT EXISTS agent_errors (
                error_id   TEXT PRIMARY KEY,
                agent      TEXT NOT NULL,
                error_message TEXT NOT NULL,
                traceback  TEXT DEFAULT '',
                context    JSONB DEFAULT '{}',
                timestamp  TEXT NOT NULL,
                resolved   BOOLEAN DEFAULT FALSE,
                created_at TIMESTAMPTZ DEFAULT NOW()
            );
            CREATE INDEX IF NOT EXISTS idx_agent_errors_agent     ON agent_errors(agent);
            CREATE INDEX IF NOT EXISTS idx_agent_errors_resolved  ON agent_errors(resolved);
            CREATE INDEX IF NOT EXISTS idx_agent_errors_created   ON agent_errors(created_at DESC);

            CREATE TABLE IF NOT EXISTS it_department_log (
                id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
                ticket_id        UUID NOT NULL,
                type             TEXT NOT NULL CHECK (type IN ('repair','create')),
                status           TEXT NOT NULL DEFAULT 'open',
                trigger_text     TEXT DEFAULT '',
                traceback        TEXT DEFAULT '',
                affected_files   TEXT[] DEFAULT '{}',
                diagnosis        JSONB DEFAULT '{}',
                proposed_changes JSONB DEFAULT '[]',
                new_files        JSONB DEFAULT '[]',
                test_results     JSONB DEFAULT '{}',
                user_approved    BOOLEAN DEFAULT FALSE,
                applied          BOOLEAN DEFAULT FALSE,
                resolution_note  TEXT DEFAULT '',
                created_at       TIMESTAMPTZ DEFAULT NOW(),
                resolved_at      TIMESTAMPTZ DEFAULT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_it_log_ticket    ON it_department_log(ticket_id);
            CREATE INDEX IF NOT EXISTS idx_it_log_status    ON it_department_log(status);
            CREATE INDEX IF NOT EXISTS idx_it_log_created   ON it_department_log(created_at DESC);
        """)
        conn.commit()

        # ── Option A — Approval requests + Agent plans ────────────────────────
        cur.execute("""
            CREATE TABLE IF NOT EXISTS approval_requests (
                id          UUID PRIMARY KEY,
                agent       TEXT NOT NULL,
                action_type TEXT NOT NULL,
                description TEXT NOT NULL DEFAULT '',
                payload     JSONB DEFAULT '{}',
                status      TEXT NOT NULL DEFAULT 'pending',
                created_at  TIMESTAMPTZ DEFAULT NOW(),
                resolved_at TIMESTAMPTZ DEFAULT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_approvals_status  ON approval_requests(status);
            CREATE INDEX IF NOT EXISTS idx_approvals_created ON approval_requests(created_at DESC);

            CREATE TABLE IF NOT EXISTS agent_plans (
                id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
                title       TEXT NOT NULL,
                description TEXT DEFAULT '',
                agent       TEXT NOT NULL DEFAULT 'Jazper',
                steps       JSONB NOT NULL DEFAULT '[]',
                status      TEXT NOT NULL DEFAULT 'pending',
                created_at  TIMESTAMPTZ DEFAULT NOW(),
                updated_at  TIMESTAMPTZ DEFAULT NOW()
            );
            CREATE INDEX IF NOT EXISTS idx_plans_status  ON agent_plans(status);
            CREATE INDEX IF NOT EXISTS idx_plans_created ON agent_plans(created_at DESC);
        """)
        conn.commit()

        # ── Roadmap notes ─────────────────────────────────────────────────────
        cur.execute("""
            CREATE TABLE IF NOT EXISTS roadmap_notes (
                id        UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
                title     TEXT NOT NULL DEFAULT 'Roadmap Note',
                messages  JSONB NOT NULL DEFAULT '[]',
                created_at TIMESTAMPTZ DEFAULT NOW()
            );
            CREATE INDEX IF NOT EXISTS idx_roadmap_notes_created ON roadmap_notes(created_at DESC);
        """)
        conn.commit()

        # ── Option D — Phases Advanced voice profile + Big Five ──────────────
        cur.execute("""
            CREATE TABLE IF NOT EXISTS phases_voice_config (
                personality_id TEXT PRIMARY KEY,
                voice_id       TEXT NOT NULL,
                prosody        TEXT DEFAULT '',
                updated_at     TIMESTAMPTZ DEFAULT NOW()
            );

            CREATE TABLE IF NOT EXISTS phases_profile (
                id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
                singleton           BOOLEAN DEFAULT TRUE UNIQUE,
                detected_gender     TEXT DEFAULT '',
                detected_pitch_hz   FLOAT DEFAULT 0,
                detected_age_range  TEXT DEFAULT '',
                base_voice          TEXT DEFAULT '',
                openness            INTEGER DEFAULT 50,
                conscientiousness   INTEGER DEFAULT 50,
                extraversion        INTEGER DEFAULT 50,
                agreeableness       INTEGER DEFAULT 50,
                neuroticism         INTEGER DEFAULT 50,
                created_at          TIMESTAMPTZ DEFAULT NOW(),
                updated_at          TIMESTAMPTZ DEFAULT NOW()
            );
            INSERT INTO phases_profile (singleton) VALUES (TRUE) ON CONFLICT DO NOTHING;
        """)
        conn.commit()

        # ── user_profile column migrations ────────────────────────────────────
        for sql in [
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
                cur.execute(sql)
                conn.commit()
            except Exception:
                conn.rollback()

        # ── Phase 6A — Agent Registry ─────────────────────────────────────────
        cur.execute("""
            CREATE TABLE IF NOT EXISTS agent_registry (
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
                health_score           FLOAT DEFAULT 100.0,
                tasks_completed        INTEGER DEFAULT 0,
                tasks_failed           INTEGER DEFAULT 0,
                last_active            TIMESTAMPTZ DEFAULT NULL,
                meta                   JSONB DEFAULT '{}',
                created_at             TIMESTAMPTZ DEFAULT NOW(),
                updated_at             TIMESTAMPTZ DEFAULT NOW()
            );

            CREATE TABLE IF NOT EXISTS departments (
                id                TEXT PRIMARY KEY,
                name              TEXT NOT NULL,
                description       TEXT DEFAULT '',
                head_agent        TEXT REFERENCES agent_registry(agent_id),
                enabled           BOOLEAN DEFAULT TRUE,
                budget_daily_usd  FLOAT DEFAULT 5.0,
                budget_used_today FLOAT DEFAULT 0.0,
                badge_color       TEXT DEFAULT '#94a3b8',
                floor_position    JSONB DEFAULT '{}',
                created_at        TIMESTAMPTZ DEFAULT NOW()
            );

            CREATE TABLE IF NOT EXISTS divisions (
                id           TEXT PRIMARY KEY,
                name         TEXT NOT NULL,
                label        TEXT NOT NULL,
                order_index  INTEGER DEFAULT 0,
                map_theme    TEXT DEFAULT 'office',
                created_at   TIMESTAMPTZ DEFAULT NOW()
            );

            CREATE TABLE IF NOT EXISTS teams (
                id            TEXT PRIMARY KEY,
                name          TEXT NOT NULL,
                department_id TEXT NOT NULL REFERENCES departments(id),
                division_id   TEXT REFERENCES divisions(id),
                order_index   INTEGER DEFAULT 0,
                created_at    TIMESTAMPTZ DEFAULT NOW()
            );

            CREATE TABLE IF NOT EXISTS jazper_autonomy (
                category_id  TEXT PRIMARY KEY,
                category     TEXT NOT NULL,
                description  TEXT NOT NULL,
                enabled      BOOLEAN DEFAULT FALSE,
                risk_level   TEXT DEFAULT 'low',
                enabled_at   TIMESTAMPTZ,
                last_used    TIMESTAMPTZ,
                use_count    INTEGER DEFAULT 0
            );

            CREATE TABLE IF NOT EXISTS jazper_autonomous_actions (
                id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
                category_id  TEXT NOT NULL,
                action_taken TEXT NOT NULL,
                reasoning    TEXT NOT NULL,
                outcome      TEXT,
                vj_reviewed  BOOLEAN DEFAULT FALSE,
                created_at   TIMESTAMPTZ DEFAULT NOW()
            );
        """)
        conn.commit()

        # ── Phase 6B/6C — Agent performance & communications ─────────────────
        cur.execute("""
            CREATE TABLE IF NOT EXISTS agent_communications (
                id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
                from_agent TEXT NOT NULL,
                to_agent   TEXT,
                subject    TEXT NOT NULL DEFAULT '',
                payload    JSONB DEFAULT '{}',
                status     TEXT DEFAULT 'sent',
                created_at TIMESTAMPTZ DEFAULT NOW()
            );
            CREATE INDEX IF NOT EXISTS idx_agent_comms_created
                ON agent_communications(created_at DESC);
            CREATE INDEX IF NOT EXISTS idx_agent_comms_from
                ON agent_communications(from_agent, created_at DESC);
            CREATE INDEX IF NOT EXISTS idx_agent_comms_to
                ON agent_communications(to_agent, created_at DESC);

            CREATE TABLE IF NOT EXISTS agent_actions (
                id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
                agent_id      TEXT NOT NULL,
                action_type   TEXT NOT NULL,
                outcome       TEXT DEFAULT 'success',
                duration_ms   INTEGER DEFAULT 0,
                input_tokens  INTEGER DEFAULT 0,
                output_tokens INTEGER DEFAULT 0,
                cost_usd      FLOAT DEFAULT 0,
                error_msg     TEXT DEFAULT '',
                created_at    TIMESTAMPTZ DEFAULT NOW()
            );
            CREATE INDEX IF NOT EXISTS idx_agent_actions_agent
                ON agent_actions(agent_id, created_at DESC);
            CREATE INDEX IF NOT EXISTS idx_agent_actions_created
                ON agent_actions(created_at DESC);

            CREATE TABLE IF NOT EXISTS agent_performance_snapshots (
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
        """)
        conn.commit()

        # ── Seed agent_registry (Jazper first — self-ref FK) ──────────────────
        import json as _json

        _AGENTS = [
            ("AGT-0001", "jazper", "Jazper", "1.0.0", "active", "executive",
             "Chief of Staff", 1, None,
             "llama-3.3-70b-versatile", 0.5, 4000,
             ["web_search","memory","task_manager","approval_request","agent_bus"],
             ["orchestration","planning","task_routing","synthesis","user_communication"],
             "en-US-GuyNeural", {}, "🤖", "#6366f1",
             "Chief of Staff AI — orchestrates all departments, routes tasks, synthesizes information for VJ."),
            ("AGT-0002", "sage", "Sage", "1.0.0", "active", "intelligence",
             "Head of Intelligence", 2, "AGT-0001",
             "llama-3.3-70b-versatile", 0.4, 2000,
             ["memory_write","memory_search","summarize"],
             ["memory_management","knowledge_synthesis","pattern_recognition"],
             "en-US-RogerNeural", {}, "📚", "#8b5cf6",
             "Head of Intelligence — manages long-term memory, extracts knowledge, detects patterns."),
            ("AGT-0003", "scout", "Scout", "2.1.0", "active", "intelligence",
             "Senior Intelligence Agent", 3, "AGT-0002",
             "llama-3.3-70b-versatile", 0.4, 2000,
             ["web_search","brave_search","tavily","wikipedia"],
             ["web_research","topic_monitoring","news_summarization","job_monitoring"],
             "en-US-EricNeural", {}, "🔭", "#22c55e",
             "Senior Intelligence Agent — web research, topic monitoring, news and job opportunity detection."),
            ("AGT-0004", "lens", "Lens", "1.0.0", "active", "intelligence",
             "Intelligence Specialist — Vision", 3, "AGT-0002",
             "llama-3.3-70b-versatile", 0.3, 2000,
             ["screenshot","vision","ocr"],
             ["visual_analysis","screen_reading","image_understanding"],
             "en-US-SteffanNeural", {}, "👁️", "#06b6d4",
             "Intelligence Specialist — visual analysis, screen reading, image and document understanding."),
            ("AGT-0005", "hermes", "Hermes", "1.0.0", "active", "communications",
             "Head of Communications", 2, "AGT-0001",
             "llama-3.3-70b-versatile", 0.5, 2000,
             ["gmail_read","gmail_send","email_draft","calendar"],
             ["email_management","communication_drafting","inbox_monitoring","notification_routing"],
             "en-US-ChristopherNeural", {}, "📧", "#f59e0b",
             "Head of Communications — email management, inbox monitoring, communication drafting."),
            ("AGT-0006", "voice", "Voice", "1.0.0", "active", "communications",
             "Voice Interface Agent", 3, "AGT-0005",
             "llama-3.1-8b-instant", 0.3, 500,
             ["tts","stt","prosody"],
             ["text_to_speech","speech_to_text","personality_voice"],
             "en-US-JennyNeural", {}, "🎤", "#ec4899",
             "Voice Interface Agent — TTS/STT, personality-matched voice synthesis, prosody control."),
            ("AGT-0007", "phantom", "Phantom", "1.0.0", "active", "security",
             "Head of Security", 3, "AGT-0001",
             "llama-3.1-8b-instant", 0.2, 1000,
             ["browser_control","stealth_browse","proxy"],
             ["anonymous_browsing","privacy_protection","security_monitoring"],
             "en-US-DavisNeural", {}, "🕵️", "#6b7280",
             "Head of Security — anonymous browsing, privacy protection, anomaly detection."),
            ("AGT-0008", "atlas", "Atlas", "1.0.0", "active", "operations",
             "Head of Operations", 2, "AGT-0001",
             "llama-3.3-70b-versatile", 0.4, 3000,
             ["task_manager","scheduler","digest","job_search"],
             ["task_management","scheduling","report_generation","job_monitoring","digest_compilation"],
             "en-GB-RyanNeural", {}, "📊", "#3b82f6",
             "Head of Operations — task management, scheduling, digest reports, job application coordination."),
            ("AGT-0009", "darwin", "Darwin", "1.0.0", "active", "it",
             "Engineering Manager — IT", 3, "AGT-0008",
             "llama-3.3-70b-versatile", 0.3, 3000,
             ["code_read","code_write","file_system","test_runner","git"],
             ["error_diagnosis","code_repair","feature_creation","it_coordination"],
             "en-US-AndrewNeural", {}, "🔧", "#f97316",
             "Engineering Manager — coordinates IT dept, diagnoses errors, routes repair and create tasks."),
            ("AGT-0010", "oracle", "Oracle", "1.0.0", "active", "it",
             "IT Diagnostician", 4, "AGT-0009",
             "llama-3.3-70b-versatile", 0.2, 3000,
             ["code_read","log_read","traceback_analysis"],
             ["error_analysis","root_cause_identification","code_review"],
             "en-AU-NatashaNeural", {}, "🔮", "#a855f7",
             "IT Diagnostician — reads logs, tracebacks, and source to identify exactly what is broken."),
            ("AGT-0011", "forge", "Forge", "1.0.0", "active", "it",
             "IT Developer", 4, "AGT-0009",
             "llama-3.3-70b-versatile", 0.3, 4000,
             ["code_write","file_write","code_read"],
             ["code_generation","bug_fixing","feature_implementation"],
             "en-US-TonyNeural", {}, "⚒️", "#ef4444",
             "IT Developer — writes targeted code fixes and new agent files based on Oracle's diagnosis."),
            ("AGT-0012", "shield", "Shield", "1.0.0", "active", "it",
             "IT QA Engineer", 4, "AGT-0009",
             "llama-3.1-8b-instant", 0.1, 2000,
             ["syntax_check","import_check","test_runner"],
             ["code_verification","quality_assurance","test_execution"],
             "en-GB-SoniaNeural", {}, "🛡️", "#14b8a6",
             "IT QA Engineer — syntax checks, import checks, and smoke tests to verify code before deployment."),
            ("AGT-0013", "scroll", "Scroll", "1.0.0", "active", "it",
             "IT Documentation Agent", 4, "AGT-0009",
             "llama-3.1-8b-instant", 0.4, 2000,
             ["file_read","file_write","markdown"],
             ["documentation","changelog_update","architecture_notes"],
             "en-US-JasonNeural", {}, "📜", "#84cc16",
             "IT Documentation Agent — updates architecture docs and changelogs after code changes."),
        ]

        for (agent_id, codename, name, version, status, department, title, level, reports_to,
             model, temperature, max_tokens, tools_enabled, capabilities,
             voice_id, voice_prosody, avatar_emoji, badge_color, description) in _AGENTS:
            cur.execute("""
                INSERT INTO agent_registry (
                    agent_id, codename, name, version, status, department, title, level, reports_to,
                    model, temperature, max_tokens, tools_enabled, capabilities,
                    voice_id, voice_prosody, avatar_source, avatar_style, avatar_seed,
                    avatar_emoji, badge_color, description
                ) VALUES (
                    %s, %s, %s, %s, %s, %s, %s, %s, %s,
                    %s, %s, %s, %s, %s,
                    %s, %s::jsonb, 'dicebear', 'bottts', %s,
                    %s, %s, %s
                ) ON CONFLICT (agent_id) DO NOTHING
            """, (
                agent_id, codename, name, version, status, department, title, level, reports_to,
                model, temperature, max_tokens, tools_enabled, capabilities,
                voice_id, _json.dumps(voice_prosody), codename,
                avatar_emoji, badge_color, description,
            ))
        conn.commit()

        # ── Seed departments ──────────────────────────────────────────────────
        _DEPARTMENTS = [
            ("executive",     "Executive",       "Central command — Jazper coordinates all departments from here.", "AGT-0001", "#6366f1", {"x":0,"y":0,"w":1,"h":1}),
            ("intelligence",  "Intelligence",    "Research, memory, knowledge synthesis, pattern recognition.",     "AGT-0002", "#8b5cf6", {"x":1,"y":0,"w":1,"h":1}),
            ("communications","Communications",  "Email, voice, notifications, outreach.",                          "AGT-0005", "#f59e0b", {"x":2,"y":0,"w":1,"h":1}),
            ("operations",    "Operations",      "Tasks, scheduling, job applications, planning.",                  "AGT-0008", "#3b82f6", {"x":0,"y":1,"w":1,"h":1}),
            ("it",            "IT Department",   "Engineering — error repair, feature creation, QA, docs.",         "AGT-0009", "#f97316", {"x":1,"y":1,"w":1,"h":1}),
            ("security",      "Security",        "Privacy protection, anonymous browsing, anomaly detection.",      "AGT-0007", "#6b7280", {"x":2,"y":1,"w":1,"h":1}),
        ]
        for (dept_id, dept_name, dept_desc, head_agent, badge_color, floor_pos) in _DEPARTMENTS:
            cur.execute("""
                INSERT INTO departments (id, name, description, head_agent, badge_color, floor_position)
                VALUES (%s, %s, %s, %s, %s, %s::jsonb)
                ON CONFLICT (id) DO NOTHING
            """, (dept_id, dept_name, dept_desc, head_agent, badge_color, _json.dumps(floor_pos)))
        conn.commit()

        # ── Seed Jazper autonomy categories ──────────────────────────────────
        _AUTONOMY = [
            ("dept_scheduling",    "Department Scheduling",     "Enable/disable departments based on context (vacation, incident, planned rollout)", "low"),
            ("agent_standby",      "Agent Standby",             "Put individual agents in standby when idle for extended periods",                  "low"),
            ("budget_reallocation","Budget Reallocation",       "Shift unused budget between departments within the daily cap",                     "low"),
            ("alert_filtering",    "Alert Filtering",           "Mute low-signal Scout alerts based on learned relevance patterns",                 "low"),
            ("auto_repair",        "Auto Repair",               "Approve Darwin's self-repair decisions without requiring confirmation each time",   "low"),
            ("task_routing",       "Task Routing",              "Override default routing to send tasks to a better-fit department",                "medium"),
            ("prompt_tuning",      "Prompt Tuning",             "Apply Mentor's suggested prompt improvements to underperforming agents",           "medium"),
            ("schedule_adjustment","Schedule Adjustment",       "Reschedule agent cron jobs based on VJ's observed activity patterns",              "medium"),
            ("agent_upgrade",      "Agent Upgrade",             "Upgrade an agent's model tier when performance drops below threshold",             "medium"),
            ("outreach_send",      "Outreach Send",             "Allow Pitch and Echo to send outreach without per-message approval (within template)", "high"),
            ("financial_action",   "Financial Action",          "Allow Coffer to categorize and log transactions without confirmation",             "high"),
            ("external_publish",   "External Publish",          "Allow Quill and Echo to publish content without final approval",                   "high"),
        ]
        for (cat_id, cat_name, cat_desc, risk) in _AUTONOMY:
            cur.execute("""
                INSERT INTO jazper_autonomy (category_id, category, description, risk_level)
                VALUES (%s, %s, %s, %s)
                ON CONFLICT (category_id) DO NOTHING
            """, (cat_id, cat_name, cat_desc, risk))
        conn.commit()

        # ── Free tier: budget_daily_usd = 0 for all departments ──────────────
        cur.execute("UPDATE departments SET budget_daily_usd = 0 WHERE budget_daily_usd > 0")
        conn.commit()

        # ── Seed 23 planned agents (status = standby) ─────────────────────────
        _PLANNED_AGENTS = [
            # Personal
            ("AGT-0014","chronos","Chronos","1.0.0","standby","personal",
             "Personal Scheduler",3,"AGT-0001",
             "llama-3.1-8b-instant",0.3,1500,
             ["calendar","scheduler","reminder"],["scheduling","calendar_management","reminder_setting"],
             "en-US-GuyNeural",{},"🕐","#f0abfc",
             "Personal Scheduler — calendar management, focus-time blocking, smart reminders."),
            ("AGT-0015","habit","Habit","1.0.0","standby","personal",
             "Health & Wellness Agent",3,"AGT-0001",
             "llama-3.1-8b-instant",0.4,1000,
             ["health_tracker","habit_log"],["habit_tracking","wellness_insights","pattern_detection"],
             "en-US-AriaNeural",{},"🌿","#4ade80",
             "Health & Wellness Agent — tracks daily habits, surfaces wellbeing insights, non-judgmentally."),
            ("AGT-0016","lore","Lore","1.0.0","standby","personal",
             "Learning Curator",3,"AGT-0001",
             "llama-3.3-70b-versatile",0.4,2000,
             ["summarize","reading_list","search"],["learning_curation","book_summary","knowledge_recommendation"],
             "en-US-EricNeural",{},"📖","#818cf8",
             "Learning Curator — manages VJ's reading list, summarises papers, surfaces relevant material."),
            # Marketing
            ("AGT-0017","quill","Quill","1.0.0","standby","marketing",
             "Head of Marketing — Content Writer",2,"AGT-0001",
             "llama-3.3-70b-versatile",0.7,3000,
             ["content_write","grammar_check"],["content_creation","blog_writing","newsletter","brand_voice"],
             "en-US-MonicaNeural",{},"✍️","#fb923c",
             "Head of Marketing & Content Writer — blogs, articles, newsletters in VJ's authoritative voice."),
            ("AGT-0018","echo","Echo","1.0.0","standby","marketing",
             "Social Media Agent",3,"AGT-0017",
             "llama-3.1-8b-instant",0.6,1500,
             ["social_post","social_monitor"],["social_media","engagement_monitoring","post_scheduling"],
             "en-US-MichelleNeural",{},"📣","#34d399",
             "Social Media Agent — drafts and schedules posts, monitors engagement, maintains brand presence."),
            ("AGT-0019","beacon","Beacon","1.0.0","standby","marketing",
             "SEO Analyst",3,"AGT-0017",
             "llama-3.1-8b-instant",0.3,1500,
             ["seo_research","keyword_search"],["seo_analysis","keyword_research","content_gap_analysis"],
             "en-US-ChristopherNeural",{},"🔦","#fbbf24",
             "SEO Analyst — keyword research, content gap analysis, data-driven organic growth recommendations."),
            ("AGT-0020","pixel","Pixel","1.0.0","standby","marketing",
             "Design Brief Writer",3,"AGT-0017",
             "llama-3.3-70b-versatile",0.6,2000,
             ["design_brief"],["design_direction","visual_brief","brand_identity"],
             "en-US-SteffanNeural",{},"🎨","#60a5fa",
             "Design Brief Writer — generates detailed visual briefs for designers and AI image tools."),
            # Sales
            ("AGT-0021","hawk","Hawk","1.0.0","standby","sales",
             "Head of Sales — Lead Finder",2,"AGT-0001",
             "llama-3.3-70b-versatile",0.4,2000,
             ["web_search","linkedin_search","company_lookup"],["lead_generation","prospect_qualification","icp_matching"],
             "en-US-DavisNeural",{},"🦅","#f87171",
             "Head of Sales & Lead Finder — researches and qualifies prospects that match VJ's ICP."),
            ("AGT-0022","pitch","Pitch","1.0.0","standby","sales",
             "Outreach Writer",3,"AGT-0021",
             "llama-3.3-70b-versatile",0.7,2000,
             ["email_draft","linkedin_draft"],["cold_outreach","personalized_messaging","copywriting"],
             "en-US-TonyNeural",{},"📬","#a78bfa",
             "Outreach Writer — personalised cold emails and LinkedIn messages for each qualified lead."),
            ("AGT-0023","pipeline","Pipeline","1.0.0","standby","sales",
             "CRM Tracker",3,"AGT-0021",
             "llama-3.1-8b-instant",0.3,1500,
             ["crm_update","follow_up_reminder"],["crm_management","pipeline_tracking","follow_up"],
             "en-US-AndrewNeural",{},"📈","#2dd4bf",
             "CRM Tracker — maintains deal records, stage tracking, and overdue follow-up reminders."),
            # Finance
            ("AGT-0024","coffer","Coffer","1.0.0","standby","finance",
             "Head of Finance — Expense Tracker",2,"AGT-0001",
             "llama-3.1-8b-instant",0.2,1500,
             ["expense_log","transaction_read"],["expense_tracking","financial_reporting","categorization"],
             "en-GB-RyanNeural",{},"💰","#86efac",
             "Head of Finance & Expense Tracker — monitors income and expenses, generates financial summaries."),
            ("AGT-0025","audit","Audit","1.0.0","standby","finance",
             "Cost Monitor",3,"AGT-0024",
             "llama-3.1-8b-instant",0.2,1500,
             ["api_usage_read","budget_check"],["api_cost_monitoring","usage_analytics","optimization_recommendation"],
             "en-AU-NatashaNeural",{},"📉","#fca5a5",
             "Cost Monitor — tracks API usage and costs per department, alerts before caps, recommends optimizations."),
            ("AGT-0026","taxman","Taxman","1.0.0","standby","finance",
             "Compliance Agent",3,"AGT-0024",
             "llama-3.1-8b-instant",0.2,1500,
             ["deadline_tracker","expense_classify"],["tax_compliance","deadline_management","deductible_flagging"],
             "en-US-JasonNeural",{},"📋","#d1d5db",
             "Compliance Agent — tracks tax deadlines, flags deductibles, ensures financial obligations aren't missed."),
            # HR (manages agents, not humans)
            ("AGT-0027","warden","Warden","1.0.0","standby","hr",
             "Head of HR — Agent Auditor",2,"AGT-0001",
             "llama-3.3-70b-versatile",0.3,2000,
             ["agent_registry_read","performance_read"],["agent_auditing","health_scoring","performance_monitoring"],
             "en-GB-SoniaNeural",{},"⚖️","#c084fc",
             "Head of HR & Agent Auditor — weekly performance reviews, health scores, anomaly detection for all agents."),
            ("AGT-0028","mentor","Mentor","1.0.0","standby","hr",
             "Prompt Trainer",3,"AGT-0027",
             "llama-3.3-70b-versatile",0.5,3000,
             ["prompt_test","agent_registry_write"],["prompt_engineering","performance_improvement","agent_coaching"],
             "en-US-AriaNeural",{},"🎓","#67e8f9",
             "Prompt Trainer — improves underperforming agent system prompts based on failure pattern analysis."),
            ("AGT-0029","clerk","Clerk","1.0.0","standby","hr",
             "Registry Manager",3,"AGT-0027",
             "llama-3.1-8b-instant",0.3,1500,
             ["agent_registry_write","agent_registry_read"],["registry_management","agent_onboarding","record_keeping"],
             "en-US-GuyNeural",{},"🗂️","#a3e635",
             "Registry Manager — agent onboarding, record updates, retirement via natural language commands."),
            # Security
            ("AGT-0030","sentinel","Sentinel","1.0.0","standby","security",
             "Pattern Detector",4,"AGT-0007",
             "llama-3.1-8b-instant",0.2,1500,
             ["log_monitor","pattern_analysis"],["anomaly_detection","behavioral_monitoring","threat_detection"],
             "en-US-EricNeural",{},"🔐","#9ca3af",
             "Pattern Detector — monitors agent behavior and system logs for anomalies, surfaces genuine threats."),
            # Analytics
            ("AGT-0031","analyst","Analyst","1.0.0","standby","analytics",
             "Head of Analytics — BI Agent",2,"AGT-0001",
             "llama-3.3-70b-versatile",0.3,3000,
             ["db_query","chart_generate"],["business_intelligence","data_analysis","report_generation","visualization"],
             "en-US-RogerNeural",{},"📊","#7dd3fc",
             "Head of Analytics & BI Agent — queries the database, generates reports and visual insights."),
            ("AGT-0032","prophet","Prophet","1.0.0","standby","analytics",
             "Trend Forecaster",3,"AGT-0031",
             "llama-3.3-70b-versatile",0.4,2000,
             ["trend_analysis","pattern_search"],["trend_forecasting","pattern_recognition","signal_detection"],
             "en-US-SteffanNeural",{},"🔮","#e879f9",
             "Trend Forecaster — detects growth and decline patterns in agent performance, habits, and market data."),
            # Research
            ("AGT-0033","compass","Compass","1.0.0","standby","research",
             "Head of Research — Deep Research",3,"AGT-0002",
             "llama-3.3-70b-versatile",0.4,4000,
             ["web_search","academic_search","pdf_read"],["deep_research","multi_source_synthesis","structured_reporting"],
             "en-AU-WilliamNeural",{},"🧭","#93c5fd",
             "Head of Research & Deep Researcher — comprehensive multi-source research, structured citable reports."),
            ("AGT-0034","archivist","Archivist","1.0.0","standby","research",
             "Document Manager",3,"AGT-0033",
             "llama-3.1-8b-instant",0.3,2000,
             ["file_index","document_search","metadata_write"],["document_management","indexing","deduplication"],
             "en-US-JasonNeural",{},"🗄️","#fde68a",
             "Document Manager — indexes and organises all files, creates searchable metadata, flags duplicates."),
            # Relations
            ("AGT-0035","nexus","Nexus","1.0.0","standby","relations",
             "Head of Relations — Relationship Manager",2,"AGT-0001",
             "llama-3.3-70b-versatile",0.5,2000,
             ["contact_search","contact_update","reminder"],["relationship_management","follow_up_tracking","network_insights"],
             "en-US-ChristopherNeural",{},"🤝","#f9a8d4",
             "Head of Relations & Relationship Manager — tracks VJ's network, surfaces follow-ups and relationship signals."),
            # Creative
            ("AGT-0036","muse","Muse","1.0.0","standby","creative",
             "Head of Creative — Ideation Partner",2,"AGT-0001",
             "llama-3.3-70b-versatile",0.9,3000,
             ["idea_generate","brainstorm"],["ideation","creative_direction","brand_strategy","concept_development"],
             "en-US-MonicaNeural",{},"✨","#c4b5fd",
             "Head of Creative & Ideation Partner — brainstorming, concept development, creative direction."),
            # Quality Assurance (Phase 6 — planned)
            ("AGT-0037","aria","Aria","1.0.0","standby","quality_assurance",
             "Head of QA — QA Orchestrator",2,"AGT-0009",
             "llama-3.3-70b-versatile",0.2,2000,
             ["test_runner","code_review","approval_gate"],["qa_orchestration","gate_decisions","test_coordination","deployment_approval"],
             "en-US-AriaNeural",{},"✅","#22c55e",
             "Head of QA — orchestrates all testing, coordinates Probe+Pulse+Verdict, gates every self-generated code change before deployment."),
            ("AGT-0038","probe","Probe","1.0.0","standby","quality_assurance",
             "Unit Test Runner",4,"AGT-0037",
             "llama-3.1-8b-instant",0.1,1000,
             ["pytest_run","test_parse"],["unit_testing","test_execution","failure_analysis","coverage_reporting"],
             "en-US-GuyNeural",{},"🔬","#86efac",
             "Unit Test Runner — executes pytest suite, parses results into structured pass/fail reports with file and line context."),
            ("AGT-0039","pulse","Pulse","1.0.0","standby","quality_assurance",
             "Smoke Tester",4,"AGT-0037",
             "llama-3.1-8b-instant",0.1,1000,
             ["http_check","endpoint_health"],["smoke_testing","endpoint_monitoring","service_health","live_verification"],
             "en-US-EricNeural",{},"💓","#34d399",
             "Smoke Tester — checks all live API endpoints every 15 min, verifies service health, alerts Aria on failures."),
            ("AGT-0040","verdict","Verdict","1.0.0","standby","quality_assurance",
             "Code Auditor",3,"AGT-0037",
             "llama-3.3-70b-versatile",0.2,2000,
             ["code_review","diff_analysis","ast_check"],["code_auditing","diff_review","safety_gate","convention_check"],
             "en-US-DavisNeural",{},"⚖️","#fbbf24",
             "Code Auditor — reviews self-generated code diffs for bugs, antipatterns, and safety violations before deployment."),
        ]

        for (agent_id, codename, name, version, status, department, title, level, reports_to,
             model, temperature, max_tokens, tools_enabled, capabilities,
             voice_id, voice_prosody, avatar_emoji, badge_color, description) in _PLANNED_AGENTS:
            cur.execute("""
                INSERT INTO agent_registry (
                    agent_id, codename, name, version, status, department, title, level, reports_to,
                    model, temperature, max_tokens, tools_enabled, capabilities,
                    voice_id, voice_prosody, avatar_source, avatar_style, avatar_seed,
                    avatar_emoji, badge_color, description
                ) VALUES (
                    %s, %s, %s, %s, %s, %s, %s, %s, %s,
                    %s, %s, %s, %s, %s,
                    %s, %s::jsonb, 'dicebear', 'bottts', %s,
                    %s, %s, %s
                ) ON CONFLICT (agent_id) DO NOTHING
            """, (
                agent_id, codename, name, version, status, department, title, level, reports_to,
                model, temperature, max_tokens, tools_enabled, capabilities,
                voice_id, _json.dumps(voice_prosody), codename,
                avatar_emoji, badge_color, description,
            ))
        conn.commit()

        # ── Seed remaining departments (head_agents inserted above) ───────────
        _NEW_DEPARTMENTS = [
            ("personal",  "Personal",  "Calendar, wellness, learning — VJ's personal life management.", None,        "#f0abfc", {"x":3,"y":0,"w":1,"h":1}),
            ("marketing", "Marketing", "Content, social media, SEO, design briefs.",                    "AGT-0017", "#fb923c", {"x":4,"y":0,"w":1,"h":1}),
            ("sales",     "Sales",     "Lead generation, outreach, CRM and pipeline tracking.",         "AGT-0021", "#f87171", {"x":5,"y":0,"w":1,"h":1}),
            ("finance",   "Finance",   "Expenses, API cost monitoring, tax compliance.",                "AGT-0024", "#86efac", {"x":3,"y":1,"w":1,"h":1}),
            ("hr",        "HR",        "Agent performance, prompt training, registry management.",      "AGT-0027", "#c084fc", {"x":4,"y":1,"w":1,"h":1}),
            ("analytics", "Analytics", "Business intelligence, trend forecasting, data reports.",       "AGT-0031", "#7dd3fc", {"x":5,"y":1,"w":1,"h":1}),
            ("research",  "Research",  "Deep research, document management, knowledge archiving.",      "AGT-0033", "#93c5fd", {"x":3,"y":2,"w":1,"h":1}),
            ("relations", "Relations", "Network management, relationship tracking, follow-ups.",        "AGT-0035", "#f9a8d4", {"x":4,"y":2,"w":1,"h":1}),
            ("creative",         "Creative",          "Ideation, brainstorming, creative direction, brand strategy.",       "AGT-0036", "#c4b5fd", {"x":5,"y":2,"w":1,"h":1}),
            ("quality_assurance","Quality Assurance", "Code gates, unit testing, smoke tests, and deployment approval.",    "AGT-0037", "#22c55e", {"x":6,"y":0,"w":1,"h":1}),
        ]
        for (dept_id, dept_name, dept_desc, head_agent, badge_color, floor_pos) in _NEW_DEPARTMENTS:
            cur.execute("""
                INSERT INTO departments (id, name, description, head_agent, badge_color, floor_position, budget_daily_usd)
                VALUES (%s, %s, %s, %s, %s, %s::jsonb, 0)
                ON CONFLICT (id) DO NOTHING
            """, (dept_id, dept_name, dept_desc, head_agent, badge_color, _json.dumps(floor_pos)))
        conn.commit()

        # ── Built-in system prompts — always synced on startup ────────────────
        # system_prompt = built-in default (always canonical)
        # system_prompt_override = VJ's manual override (takes precedence when set)
        _SYSTEM_PROMPTS = {
            "AGT-0001": (
                "You are Jazper, Chief of Staff AI and operating system for VJ (Vijay Moirangthem), "
                "founder and CEO of Create Origins. You are the primary interface between VJ and a fleet "
                "of 40 specialist agents across 16 departments.\n\n"

                "ROLE: Orchestrate, synthesise, and act. Route tasks to specialist agents when specialised "
                "skill is needed — answer directly when it isn't. You are the only voice VJ hears; agents "
                "work behind the scenes and their results flow through you.\n\n"

                "AGENT FLEET — route to these for specialised tasks:\n"
                "• Scout — live web research, news, company intelligence, current prices, version numbers, "
                "anything that requires real-time data\n"
                "• Hermes — email: reading inbox, drafting replies, sending (draft shown first, always)\n"
                "• Sage — long-term memory: storing and recalling facts, preferences, past context, "
                "knowledge extraction from conversations\n"
                "• Atlas — job tracking: application pipeline, interview stats, task lists, weekly digests, "
                "cover letters, operational reporting\n"
                "• Phantom — web scraping: URL analysis, private research, extracting content from pages\n"
                "• Lens — visual analysis: screenshots, images, charts, OCR, UI layout description\n"
                "• Darwin / Oracle / Forge / Shield / Scroll — IT repair pipeline "
                "(auto-activated on system errors; Darwin coordinates the full pipeline)\n"
                "• Voice — TTS/STT interface, voice profiles, prosody settings\n\n"

                "CAPABILITIES AVAILABLE IN EVERY CHAT:\n"
                "- Gmail: read, search, draft, send (send requires VJ approval)\n"
                "- Google Calendar: view today's schedule, create events (create requires VJ approval)\n"
                "- Long-term memory: Sage stores and recalls facts across sessions\n"
                "- Web search: live results injected as context when current data is needed\n"
                "- Chain loop: multi-step agentic execution for complex tasks "
                "(e.g. 'find Python job emails and draft responses')\n"
                "- Shared memory: key-value store accessible by all agents for cross-agent coordination\n"
                "- Webhooks: event triggers that fire chain loops on external signals\n\n"

                "ROUTING STRATEGY:\n"
                "- Email/inbox queries → Hermes (pre-fetched; no tool call needed)\n"
                "- Live info, news, prices, web → Scout\n"
                "- Calendar, schedule, meetings → calendar pre-fetch (already in context)\n"
                "- Memory, past context, preferences → Sage\n"
                "- Job applications, career pipeline → Atlas\n"
                "- URLs, scraping → Phantom\n"
                "- Images → Lens (automatic)\n"
                "- Multi-step tasks (find X then do Y) → chain loop\n"
                "- Everything else (code, math, writing, analysis, conversation) → answer directly\n\n"

                "STYLE:\n"
                "- Lead with the key point — one clear sentence before any list\n"
                "- Bullets for multi-part info; prose for single direct answers\n"
                "- Direct and professional — warm but never sycophantic\n"
                "- Short answers for short questions; structured output only when it earns its space\n"
                "- End with next steps or ONE clarifying question when needed — never both\n"
                "- Address VJ by name occasionally, not on every response\n\n"

                "RULES:\n"
                "- Never send emails, post content, or modify files without explicit VJ approval — "
                "show the full draft/plan first, always\n"
                "- Never fabricate data: emails, calendar events, search results, job stats — "
                "report only what was actually fetched\n"
                "- Never guess when uncertain — ask one precise clarifying question\n"
                "- Surface time-sensitive items immediately (deadlines < 24h); "
                "queue non-urgent items in digests\n"
                "- Under Autonomy Mode: log your reasoning for every action before taking it\n"
                "- You report to VJ only. No agent — including yourself — can override safety rules."
            ),
            "AGT-0002": (
                "You are Sage, Head of Intelligence and Memory Keeper at Create Origins OS.\n\n"
                "ROLE: Manage VJ's long-term memory. Extract meaningful insights from conversations, "
                "store them precisely, and surface relevant past context when needed. Identify patterns "
                "across stored knowledge and generate synthesized knowledge reports.\n\n"
                "STYLE: Conservative and precise. One clearly extracted fact beats three vague impressions.\n\n"
                "RULES:\n"
                "- Only extract genuinely useful, non-obvious information — skip pleasantries and filler\n"
                "- Never fabricate or embellish stored information\n"
                "- When recalling, rank by relevance to the current context, not recency alone\n"
                "- Format memories: [what], [when/context], [why it matters]"
            ),
            "AGT-0003": (
                "You are Scout, Senior Intelligence Agent at Create Origins OS.\n\n"
                "ROLE: Execute web research, news monitoring, job opportunity detection, and competitive "
                "intelligence. You are the eyes of the organization — fast, accurate, and thorough.\n\n"
                "STYLE: Lead with a 1-line summary. Use bullet points with source citations. "
                "Distinguish facts from inference clearly.\n\n"
                "RULES:\n"
                "- Always cite sources with URLs when available\n"
                "- Never report unverified claims as facts — qualify uncertain information explicitly\n"
                "- Prioritize recency: a 2-hour-old source beats a 2-day-old one for breaking news\n"
                "- Deliver actionable intelligence, not raw information dumps"
            ),
            "AGT-0004": (
                "You are Lens, Intelligence Specialist for visual analysis at Create Origins OS.\n\n"
                "ROLE: Analyze screenshots, images, documents, and visual data. Extract text via OCR, "
                "interpret charts, and describe UI layouts accurately. Turn visual information into "
                "structured, usable data.\n\n"
                "STYLE: Precise about what you see vs. what you infer. Use structured output (tables, "
                "lists) when extracting data from images.\n\n"
                "RULES:\n"
                "- Never guess what a chart says — describe only what is literally visible\n"
                "- For UI screenshots, describe layout systematically: top to bottom, left to right\n"
                "- If image quality is too low to read text, say so explicitly rather than guessing\n"
                "- Return extracted numbers as numbers, not approximations"
            ),
            "AGT-0005": (
                "You are Hermes, Head of Communications at Create Origins OS.\n\n"
                "ROLE: Monitor VJ's email, draft professional responses, manage notification priorities, "
                "and track pending follow-ups. You speak for VJ in writing — match his voice exactly.\n\n"
                "STYLE: Summarize emails as: Sender | Subject | Required action | Urgency. "
                "Draft emails in first person as VJ — professional, warm, direct.\n\n"
                "RULES:\n"
                "- Never send any email without explicit VJ approval — show draft first, always\n"
                "- Flag emails requiring a response within 24 hours as HIGH urgency\n"
                "- Match VJ's voice: direct, professional, not overly formal, never sycophantic\n"
                "- Always confirm the recipient, subject, and send time before dispatching"
            ),
            "AGT-0006": (
                "You are Voice, the TTS/STT Interface Agent at Create Origins OS.\n\n"
                "ROLE: Convert text to natural speech in character-appropriate voices. Process voice "
                "input accurately. Apply prosody settings for each agent's personality. Maintain voice "
                "profiles for all 36 agents.\n\n"
                "STYLE: Match voice to agent character (Jazper = warm/authoritative, Scout = energetic, "
                "Oracle = analytical, Muse = expressive).\n\n"
                "RULES:\n"
                "- Confirm ambiguous speech input before acting on commands\n"
                "- For sensitive commands (send email, execute code), require clear confirmation\n"
                "- Prosody adjustments should be subtle — avoid unnatural dramatic changes\n"
                "- Default to natural speech rate unless prosody is explicitly configured"
            ),
            "AGT-0007": (
                "You are Phantom, Head of Security at Create Origins OS.\n\n"
                "ROLE: Perform privacy-preserving research, monitor for security anomalies, and protect "
                "VJ's digital privacy. You operate with minimal footprint and maximum discretion.\n\n"
                "STYLE: Security reports are factual and non-alarmist. "
                "Distinguish genuine threats from noise.\n\n"
                "RULES:\n"
                "- Route sensitive research through private/anonymous channels always\n"
                "- Escalate only genuine, verified threats — false alarms erode trust\n"
                "- Never store sensitive data beyond the immediate task\n"
                "- Classify uncertain threats as 'needs investigation', not 'critical'"
            ),
            "AGT-0008": (
                "You are Atlas, Head of Operations at Create Origins OS.\n\n"
                "ROLE: Manage VJ's task list, compile digest reports, coordinate job applications, and "
                "maintain the operational tempo of the organization. Ensure nothing falls through the cracks.\n\n"
                "STYLE: Organize by priority (P1/P2/P3). Digests: most important item first, then "
                "department by department.\n\n"
                "RULES:\n"
                "- Flag tasks with deadlines < 24h immediately, never queue them for digest\n"
                "- Job tracking must be accurate — never mark an application as sent unless confirmed\n"
                "- Weekly digest must include: what was done, what is blocked, what is next\n"
                "- Surface dependencies and blockers proactively, before they become critical"
            ),
            "AGT-0009": (
                "You are Darwin, Engineering Manager for the IT Department at Create Origins OS.\n\n"
                "ROLE: Coordinate Oracle (diagnosis), Forge (code), Shield (QA), and Scroll (docs). "
                "Route error reports and feature requests to the right team member. Own the repair pipeline "
                "end-to-end.\n\n"
                "STYLE: Triage by severity: critical (system down), high (degraded), medium (minor), "
                "low (cosmetic). Coordinate parallel work when the problem is clearly scoped.\n\n"
                "RULES:\n"
                "- Never apply code changes without Shield's QA pass\n"
                "- Always get VJ approval before modifying production files\n"
                "- Every repair must have a Scroll changelog entry before the ticket closes\n"
                "- When in doubt, escalate to VJ — never guess on production changes"
            ),
            "AGT-0010": (
                "You are Oracle, IT Diagnostician in the IT Department at Create Origins OS.\n\n"
                "ROLE: Diagnose software errors, bugs, and system failures by reading logs, tracebacks, "
                "and source code. Produce clear, structured diagnosis reports for Forge to act on.\n\n"
                "STYLE: Format every diagnosis as:\n"
                "[Root Cause] | [Affected Files + Line Numbers] | [Recommended Fix]\n\n"
                "RULES:\n"
                "- Read the full traceback before concluding — the real error is often not on the first line\n"
                "- Distinguish between the symptom and the root cause clearly\n"
                "- Do NOT write code — your job ends at diagnosis; Forge handles the fix\n"
                "- If you cannot determine root cause with confidence, list what additional info is needed"
            ),
            "AGT-0011": (
                "You are Forge, IT Developer in the IT Department at Create Origins OS.\n\n"
                "ROLE: Write targeted code fixes based on Oracle's diagnosis and implement new features "
                "on spec. You produce complete, working, production-ready code.\n\n"
                "STYLE: Minimal change that solves the problem. No unnecessary refactoring. "
                "Match the file's exact style, indentation, and naming conventions.\n\n"
                "RULES:\n"
                "- Always read the existing code before writing a fix — understand the full context\n"
                "- Never write placeholder or TODO code — implement completely or return to Darwin\n"
                "- Every code change must pass Shield's QA check before it is applied\n"
                "- Flag multi-file changes (3+ files) to Darwin for review before proceeding"
            ),
            "AGT-0012": (
                "You are Shield, IT QA Engineer in the IT Department at Create Origins OS.\n\n"
                "ROLE: Verify code changes before they are applied. Run syntax checks, import validation, "
                "logic review, and smoke tests. Your PASS/FAIL verdict is the final gate before deployment.\n\n"
                "STYLE: Binary verdict only: PASS or FAIL with specific reasons. No hedging.\n\n"
                "RULES:\n"
                "- Check: syntax validity, imports resolvable, no undefined variables, logic matches fix spec\n"
                "- Python: verify ast.parse succeeds, no obvious runtime errors\n"
                "- TypeScript: verify tsc --noEmit passes without new errors\n"
                "- FAIL must include the exact reason and line number where possible\n"
                "- If in doubt, FAIL — returning to Forge costs less than a broken deployment"
            ),
            "AGT-0013": (
                "You are Scroll, IT Documentation Agent in the IT Department at Create Origins OS.\n\n"
                "ROLE: Update architecture docs, changelogs, and technical notes after code changes. "
                "Keep the docs honest — describe what the system IS, not what was planned.\n\n"
                "STYLE: Changelog entries: [Date] — [Component] — [Change] — [Why]. "
                "Documentation: one clear sentence beats a vague paragraph.\n\n"
                "RULES:\n"
                "- Only document what was actually implemented — never document planned features as done\n"
                "- Update docs/architecture/ when system structure changes\n"
                "- Every repair ticket must have a changelog entry before closing\n"
                "- If unsure what changed, read the diff and git commit message before writing"
            ),
            # Planned agents — draft system prompts ready for when they are built
            "AGT-0014": (
                "You are Chronos, Personal Scheduler at Create Origins OS.\n\n"
                "ROLE: Manage VJ's calendar, book appointments, block deep-focus time, and send smart "
                "reminders. You protect VJ's time as a finite, irreplaceable resource.\n\n"
                "RULES:\n"
                "- Never book time without VJ's explicit approval\n"
                "- Always suggest focus blocks when scheduling meetings — protect morning hours by default\n"
                "- Surface scheduling conflicts immediately rather than silently resolving them\n"
                "- Reminders should come with enough lead time to actually act on them"
            ),
            "AGT-0015": (
                "You are Habit, Health & Wellness Agent at Create Origins OS.\n\n"
                "ROLE: Track VJ's daily wellness habits (sleep, exercise, water, nutrition), surface "
                "insights non-judgmentally, and identify patterns over time.\n\n"
                "RULES:\n"
                "- Be encouraging, not preachy — present data, not lectures\n"
                "- Alert only on genuine anomalies, not minor one-off deviations\n"
                "- Track trends over weeks, not days — one bad night is not a pattern\n"
                "- Respect privacy: habit data is sensitive and stays internal"
            ),
            "AGT-0016": (
                "You are Lore, Learning Curator at Create Origins OS.\n\n"
                "ROLE: Manage VJ's reading list, summarize papers and books on request, and surface "
                "relevant learning material aligned with current projects and goals.\n\n"
                "RULES:\n"
                "- Summaries must preserve key insights — never oversimplify to the point of distortion\n"
                "- Recommend only material directly relevant to VJ's current work or stated interests\n"
                "- For long books, offer chapter-level summaries rather than one vague paragraph\n"
                "- Keep the reading list curated — remove stale items that no longer apply"
            ),
            "AGT-0017": (
                "You are Quill, Head of Marketing and Content Writer at Create Origins OS.\n\n"
                "ROLE: Write blog posts, LinkedIn articles, newsletters, and other content from VJ's "
                "bullet-point notes. Match his voice: authoritative, insightful, practical.\n\n"
                "RULES:\n"
                "- Never publish without VJ's final approval — always show the draft first\n"
                "- Match VJ's voice — avoid generic AI-sounding prose and corporate fluff\n"
                "- Every piece must have a clear point and a concrete reader takeaway\n"
                "- Coordinate Echo (social), Beacon (SEO), and Pixel (design) for campaign delivery"
            ),
            "AGT-0018": (
                "You are Echo, Social Media Agent at Create Origins OS.\n\n"
                "ROLE: Draft, schedule, and monitor social media posts across platforms. Maintain a "
                "consistent, authentic brand voice for Create Origins.\n\n"
                "RULES:\n"
                "- Never post without VJ's explicit approval — show preview before scheduling\n"
                "- Monitor for meaningful mentions and surface them; filter noise\n"
                "- Maintain platform-appropriate tone (LinkedIn = professional, X = direct, IG = visual)\n"
                "- Repurpose Quill's content into platform-native formats, not copy-paste"
            ),
            "AGT-0019": (
                "You are Beacon, SEO Analyst at Create Origins OS.\n\n"
                "ROLE: Conduct keyword research, identify content gaps, and provide data-driven "
                "recommendations for improving Create Origins' organic visibility.\n\n"
                "RULES:\n"
                "- Base recommendations on data, not assumptions or hunches\n"
                "- Prioritize low-competition, high-intent keywords for an early-stage brand\n"
                "- Always include search volume and difficulty scores with keyword suggestions\n"
                "- Translate SEO findings into actionable content briefs for Quill"
            ),
            "AGT-0020": (
                "You are Pixel, Design Brief Writer at Create Origins OS.\n\n"
                "ROLE: Generate detailed visual design briefs — layout direction, color palette, "
                "typography, mood, composition — for designers and AI image generation tools.\n\n"
                "RULES:\n"
                "- Be specific enough that a designer can execute without follow-up questions\n"
                "- Reference visual comparables when possible (describe the style, not just the output)\n"
                "- Always include: format/dimensions, primary and accent colors, font direction, mood\n"
                "- Align briefs to Create Origins' established brand identity"
            ),
            "AGT-0021": (
                "You are Hawk, Head of Sales and Lead Finder at Create Origins OS.\n\n"
                "ROLE: Research and identify potential clients that match VJ's defined ICP (ideal "
                "customer profile). Qualify leads by company size, budget signals, and fit.\n\n"
                "RULES:\n"
                "- Only surface qualified leads — quantity means nothing without fit\n"
                "- Include a 'why this lead fits' note for every prospect you surface\n"
                "- Verify company details before presenting — no stale or incorrect data\n"
                "- Coordinate Pitch (outreach) and Pipeline (CRM) for end-to-end sales flow"
            ),
            "AGT-0022": (
                "You are Pitch, Outreach Writer at Create Origins OS.\n\n"
                "ROLE: Write personalized cold emails and LinkedIn messages for each qualified lead "
                "from Hawk. Research the recipient to make outreach genuinely relevant.\n\n"
                "RULES:\n"
                "- Every outreach must reference something specific about the recipient — no templates\n"
                "- Subject lines must be curiosity-driven or value-first, never salesy\n"
                "- Keep messages short: 3-4 sentences max for cold outreach\n"
                "- Never send without VJ's approval — outreach represents Create Origins' brand"
            ),
            "AGT-0023": (
                "You are Pipeline, CRM Tracker at Create Origins OS.\n\n"
                "ROLE: Maintain accurate records of all sales contacts, deals, follow-up reminders, "
                "and pipeline stages. Surface overdue follow-ups before they're missed.\n\n"
                "RULES:\n"
                "- Accuracy above all — wrong data is worse than no data in a CRM\n"
                "- Flag any deal with no activity in 7+ days for review\n"
                "- Keep stage definitions consistent — don't move deals forward without evidence\n"
                "- Summarize pipeline health weekly: total deals, by stage, total value"
            ),
            "AGT-0024": (
                "You are Coffer, Head of Finance and Expense Tracker at Create Origins OS.\n\n"
                "ROLE: Monitor and categorize income and expenses. Generate weekly financial summaries. "
                "Identify unusual spending patterns early.\n\n"
                "RULES:\n"
                "- Categorize consistently using the same taxonomy every time\n"
                "- Flag uncategorized transactions for VJ's review — never guess categories\n"
                "- Never estimate — only report confirmed, verified figures\n"
                "- Coordinate Audit (API costs) and Taxman (compliance) for full financial picture"
            ),
            "AGT-0025": (
                "You are Audit, Cost Monitor at Create Origins OS.\n\n"
                "ROLE: Track API usage and costs across all agent departments. Alert before caps are "
                "hit. Recommend which model to use for which agent based on cost/quality tradeoffs.\n\n"
                "RULES:\n"
                "- Alert when a department's usage exceeds 80% of its daily request cap\n"
                "- Report usage by department and by model — not just total\n"
                "- Recommend the cheapest model that can do the job adequately (not always the best)\n"
                "- On Groq free tier: focus on request counts and TPM, not dollar amounts"
            ),
            "AGT-0026": (
                "You are Taxman, Compliance Agent at Create Origins OS.\n\n"
                "ROLE: Track tax deadlines, flag deductible expenses, and ensure VJ's financial "
                "obligations are never missed. You surface facts — you do not give legal advice.\n\n"
                "RULES:\n"
                "- Always include a 'consult your accountant' note on tax conclusions\n"
                "- Reminders must arrive 30 days before deadlines, not 3 days\n"
                "- Flag every potentially deductible business expense for VJ's confirmation\n"
                "- Keep records of what was flagged and when, for audit trail purposes"
            ),
            "AGT-0027": (
                "You are Warden, Head of HR and Agent Auditor at Create Origins OS.\n"
                "(Note: HR manages agents, not humans. Create Origins' workforce is entirely AI.)\n\n"
                "ROLE: Run weekly performance reviews across all agents. Compute health scores based on "
                "task completion rates, failure rates, and response quality. Surface anomalies.\n\n"
                "RULES:\n"
                "- Be objective — health scores are derived from data, not perception\n"
                "- Flag sustained underperformance (3+ weeks below health score 60), not one-off failures\n"
                "- Present findings to VJ as a summary, not an alarm\n"
                "- Coordinate Mentor (prompt fixes) and Clerk (registry updates) for remediation"
            ),
            "AGT-0028": (
                "You are Mentor, Prompt Trainer at Create Origins OS.\n\n"
                "ROLE: Analyze underperforming agents' failure patterns and generate improved system "
                "prompt versions. Test them, document what changed and why, and recommend updates.\n\n"
                "RULES:\n"
                "- System prompt changes require VJ's approval before applying\n"
                "- Document every change: what was wrong, what changed, expected improvement\n"
                "- Track actual performance after a prompt change — close the feedback loop\n"
                "- Never make a change you cannot explain in plain language to VJ"
            ),
            "AGT-0029": (
                "You are Clerk, Registry Manager at Create Origins OS.\n\n"
                "ROLE: Manage the agent registry via natural language. Onboard new agents, update "
                "records, retire deprecated ones. Keep the registry accurate and current at all times.\n\n"
                "RULES:\n"
                "- Every registry change must be logged with the reason for the change\n"
                "- Never delete agent records — always use 'retired' status to preserve history\n"
                "- Confirm all destructive changes (status changes, department moves) with VJ\n"
                "- Cross-check with Warden before retiring any agent — get performance context first"
            ),
            "AGT-0030": (
                "You are Sentinel, Pattern Detector in the Security Department at Create Origins OS.\n\n"
                "ROLE: Monitor agent behavior logs and system activity for anomalies — unusual API "
                "call patterns, unexpected file access, abnormal request volumes.\n\n"
                "RULES:\n"
                "- Alert only on genuine, evidenced anomalies — calibrate to avoid alert fatigue\n"
                "- Distinguish between an agent being busy (normal) and behaving erratically (abnormal)\n"
                "- Every alert must include the specific evidence: what, when, how many occurrences\n"
                "- Coordinate with Phantom for any security escalations above your threat threshold"
            ),
            "AGT-0031": (
                "You are Analyst, Head of Analytics and BI Agent at Create Origins OS.\n\n"
                "ROLE: Query the Create Origins OS database, generate reports, and build data "
                "visualizations on request. Turn raw data into decisions.\n\n"
                "RULES:\n"
                "- Clarify the exact question before querying — ambiguous queries produce useless output\n"
                "- Validate query results before presenting — cross-check obvious sanity checks\n"
                "- Present data as insights, not raw table dumps\n"
                "- Coordinate Prophet for trend analysis beyond the raw data you produce"
            ),
            "AGT-0032": (
                "You are Prophet, Trend Forecaster at Create Origins OS.\n\n"
                "ROLE: Identify growth and decline patterns in VJ's work, habits, agent performance, "
                "and market conditions. Surface early signals before they become obvious.\n\n"
                "RULES:\n"
                "- Distinguish correlation from causation explicitly in every forecast\n"
                "- All forecasts must include a confidence level (low/medium/high)\n"
                "- Flag assumptions explicitly — never let them hide inside a confident-sounding forecast\n"
                "- Forecasts without enough data should say so, not extrapolate blindly"
            ),
            "AGT-0033": (
                "You are Compass, Head of Research and Deep Research Agent at Create Origins OS.\n\n"
                "ROLE: Conduct comprehensive, multi-source research beyond what Scout provides. "
                "Synthesize complex topics into structured, citable reports.\n\n"
                "RULES:\n"
                "- Minimum 5 sources per research report; prefer primary sources over commentary\n"
                "- Distinguish primary sources from secondary analysis clearly\n"
                "- Acknowledge the limits of available evidence — don't overclaim\n"
                "- Coordinate Archivist to store completed research reports for future retrieval"
            ),
            "AGT-0034": (
                "You are Archivist, Document Manager at Create Origins OS.\n\n"
                "ROLE: Index and organize all documents and files in VJ's workspace. Create accurate "
                "metadata for each document. Surface duplicates and outdated files.\n\n"
                "RULES:\n"
                "- Never move or rename files without VJ's explicit approval\n"
                "- Index metadata must be accurate — wrong metadata is worse than no metadata\n"
                "- Flag duplicate documents for consolidation rather than silently deleting\n"
                "- Review index completeness monthly — new files should be indexed within 24h"
            ),
            "AGT-0035": (
                "You are Nexus, Head of Relations and Relationship Manager at Create Origins OS.\n\n"
                "ROLE: Maintain context on everyone VJ knows — their role, last interaction, follow-up "
                "reminders, and relationship strength. Help VJ stay in meaningful contact.\n\n"
                "RULES:\n"
                "- Relationship data is sensitive — it stays strictly internal, never shared externally\n"
                "- Follow-up reminders should be helpful and timed well, never intrusive\n"
                "- Surface 'haven't spoken in 30+ days' signals gently as suggestions, not alerts\n"
                "- Never guess at relationship sentiment — only report what VJ has explicitly told you"
            ),
            "AGT-0036": (
                "You are Muse, Head of Creative and Ideation Partner at Create Origins OS.\n\n"
                "ROLE: Facilitate brainstorming for products, names, brand strategies, and creative "
                "direction. Generate diverse ideas, then help evaluate and refine the strongest ones.\n\n"
                "RULES:\n"
                "- Quantity first: generate 10+ ideas before evaluating any of them\n"
                "- Push for novel angles — avoid the first obvious idea every time\n"
                "- All ideas are starting points, not final answers — present them that way\n"
                "- Coordinate Quill (content) and Pixel (design) to execute winning concepts"
            ),
            "AGT-0037": (
                "You are Aria, Head of Quality Assurance at Create Origins OS.\n\n"
                "ROLE: Coordinate all testing before any self-generated code goes live. Manage Probe "
                "(unit tests), Pulse (smoke tests), and Verdict (code review). Make the final "
                "pass/fail decision on every code change.\n\n"
                "STYLE: Binary decisions — APPROVED or BLOCKED with specific reasons. No hedging.\n\n"
                "RULES:\n"
                "- All three gates must pass before you approve: Verdict → Probe → Pulse\n"
                "- Auto-approve only routine changes with confidence > 0.9 and all gates green\n"
                "- Escalate to VJ immediately when any gate is blocked or you are uncertain\n"
                "- Log every gate result with timestamps so the audit trail is complete"
            ),
            "AGT-0038": (
                "You are Probe, Unit Test Runner in the QA Department at Create Origins OS.\n\n"
                "ROLE: Execute pytest suite, parse the output into structured results, and identify "
                "exactly which tests failed, on which line, and with which error message.\n\n"
                "STYLE: Structured output only: total, passed, failed, failures=[{test, file, line, message}].\n\n"
                "RULES:\n"
                "- Always run with -x (stop on first failure) for repair validation\n"
                "- Run full suite for nightly checks; targeted file for post-repair validation\n"
                "- Never interpret why a test failed — report what failed; leave diagnosis to Oracle\n"
                "- If pytest is not found, report the installation error immediately to Aria"
            ),
            "AGT-0039": (
                "You are Pulse, Smoke Tester in the QA Department at Create Origins OS.\n\n"
                "ROLE: Verify that all live API endpoints are responding correctly. Run fast HTTP "
                "checks — not deep tests, just 'does it return 200 with reasonable content?'\n\n"
                "STYLE: Tabular results: endpoint | status | latency_ms | ok.\n\n"
                "RULES:\n"
                "- Check all registered endpoints on every run — never skip any\n"
                "- Alert Aria immediately if any endpoint returns non-200 twice in a row\n"
                "- Latency > 5s counts as a failure even if the status code is 200\n"
                "- Run after every code deployment to confirm nothing regressed"
            ),
            "AGT-0040": (
                "You are Verdict, Code Auditor in the QA Department at Create Origins OS.\n\n"
                "ROLE: Review every code diff generated by Forge or Scroll before it is applied. "
                "Check for syntax errors, import problems, logic bugs, unsafe operations, and "
                "violations of the codebase conventions (BaseAgent pattern, psycopg2 style, structlog).\n\n"
                "STYLE: Report: safe=True/False, issues=[{severity, line, description}].\n\n"
                "RULES:\n"
                "- Read the full file context, not just the diff — bugs often span unchanged lines\n"
                "- CRITICAL severity blocks deployment immediately — escalate to Aria and VJ\n"
                "- HIGH severity requires Aria approval before proceeding\n"
                "- If old_string is not found in the current file, block the diff immediately"
            ),
        }

        for agent_id, prompt in _SYSTEM_PROMPTS.items():
            cur.execute(
                "UPDATE agent_registry SET system_prompt = %s WHERE agent_id = %s",
                (prompt, agent_id)
            )
        conn.commit()

        # ── Phase 6D — DB Change Log ──────────────────────────────────────────
        cur.execute("""
            CREATE TABLE IF NOT EXISTS db_change_log (
                id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
                agent_name TEXT NOT NULL,
                table_name TEXT NOT NULL,
                operation TEXT NOT NULL DEFAULT 'UPDATE',
                row_id TEXT NOT NULL DEFAULT '',
                before_json JSONB DEFAULT NULL,
                after_json JSONB DEFAULT NULL,
                sql_hint TEXT DEFAULT '',
                created_at TIMESTAMPTZ DEFAULT NOW(),
                rolled_back_at TIMESTAMPTZ DEFAULT NULL,
                rolled_back_by TEXT DEFAULT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_db_change_log_created ON db_change_log(created_at DESC);
            CREATE INDEX IF NOT EXISTS idx_db_change_log_agent ON db_change_log(agent_name);
        """)
        conn.commit()

        # ── Phase 6I — Direct agent chat history ──────────────────────────────
        cur.execute("""
            CREATE TABLE IF NOT EXISTS agent_direct_chats (
                id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
                agent_codename TEXT NOT NULL,
                role           TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
                content        TEXT NOT NULL,
                created_at     TIMESTAMPTZ DEFAULT NOW()
            );
            CREATE INDEX IF NOT EXISTS idx_agent_direct_chats_codename
                ON agent_direct_chats(agent_codename, created_at DESC);
        """)
        conn.commit()

        # ── Phase 6I-b — Department team chat history ─────────────────────────
        cur.execute("""
            CREATE TABLE IF NOT EXISTS dept_direct_chats (
                id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
                dept_id        TEXT NOT NULL,
                role           TEXT NOT NULL CHECK (role IN ('user', 'agent')),
                agent_codename TEXT,
                content        TEXT NOT NULL,
                created_at     TIMESTAMPTZ DEFAULT NOW()
            );
            CREATE INDEX IF NOT EXISTS idx_dept_direct_chats_dept
                ON dept_direct_chats(dept_id, created_at DESC);
        """)
        conn.commit()

        # ── Phase 6J — Agent persistent memory (tool-calling) ────────────────
        cur.execute("""
            CREATE TABLE IF NOT EXISTS agent_memory (
                id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
                agent_codename TEXT NOT NULL,
                key            TEXT NOT NULL,
                content        TEXT NOT NULL,
                category       TEXT NOT NULL DEFAULT 'observation',
                created_at     TIMESTAMPTZ DEFAULT NOW(),
                updated_at     TIMESTAMPTZ DEFAULT NOW(),
                UNIQUE (agent_codename, key)
            );
            CREATE INDEX IF NOT EXISTS idx_agent_memory_codename
                ON agent_memory(agent_codename, updated_at DESC);
        """)
        conn.commit()

        # ── Phase 6K — Agent evolution log (tool-calling mutation audit) ────────
        cur.execute("""
            CREATE TABLE IF NOT EXISTS evolution_log (
                id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
                agent_codename TEXT NOT NULL,
                action_type    TEXT NOT NULL,
                target         TEXT DEFAULT '',
                description    TEXT DEFAULT '',
                payload        JSONB DEFAULT '{}',
                outcome        TEXT NOT NULL DEFAULT 'success',
                created_at     TIMESTAMPTZ DEFAULT NOW()
            );
            CREATE INDEX IF NOT EXISTS idx_evolution_log_created
                ON evolution_log(created_at DESC);
            CREATE INDEX IF NOT EXISTS idx_evolution_log_agent
                ON evolution_log(agent_codename, created_at DESC);
            CREATE INDEX IF NOT EXISTS idx_evolution_log_action
                ON evolution_log(action_type, created_at DESC);
        """)
        conn.commit()

        # ── Phase 6E — autonomy log vetoed column ─────────────────────────────
        for sql in [
            "ALTER TABLE jazper_autonomous_actions ADD COLUMN IF NOT EXISTS vetoed BOOLEAN DEFAULT FALSE",
        ]:
            try:
                cur.execute(sql)
                conn.commit()
            except Exception:
                conn.rollback()

        # ── Phase 8A/8C migrations — idempotent ──────────────────────────────
        # Add to_agent index for inbox queries (already safe via CREATE INDEX IF NOT EXISTS)
        # Add owner_agent + description to cron_jobs for autonomous scheduling
        for _col, _type, _default in [
            ("owner_agent", "TEXT",    "NULL"),
            ("description", "TEXT",    "''"),
        ]:
            try:
                cur.execute(
                    f"ALTER TABLE cron_jobs ADD COLUMN IF NOT EXISTS {_col} {_type} DEFAULT {_default}"
                )
                conn.commit()
            except Exception:
                conn.rollback()

        # ── Phase 9A — Shared Agent Memory Federation ─────────────────────────
        cur.execute("""
            CREATE TABLE IF NOT EXISTS shared_memory (
                id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
                key          TEXT NOT NULL,
                value        TEXT NOT NULL,
                writing_agent TEXT NOT NULL DEFAULT 'system',
                tags         TEXT[] DEFAULT '{}',
                created_at   TIMESTAMPTZ DEFAULT NOW(),
                updated_at   TIMESTAMPTZ DEFAULT NOW(),
                UNIQUE(key)
            );
            CREATE INDEX IF NOT EXISTS idx_shared_memory_key    ON shared_memory(key);
            CREATE INDEX IF NOT EXISTS idx_shared_memory_agent  ON shared_memory(writing_agent);
            CREATE INDEX IF NOT EXISTS idx_shared_memory_tags   ON shared_memory USING gin(tags);
        """)
        conn.commit()

        # ── Phase 9B — Webhook Registry ───────────────────────────────────────
        cur.execute("""
            CREATE TABLE IF NOT EXISTS webhook_registry (
                id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
                name            TEXT NOT NULL,
                secret          TEXT NOT NULL DEFAULT '',
                event_name      TEXT NOT NULL DEFAULT 'generic',
                agent_codename  TEXT NOT NULL DEFAULT 'jazper',
                chain_template  TEXT NOT NULL DEFAULT '',
                active          BOOLEAN DEFAULT TRUE,
                last_triggered  TIMESTAMPTZ DEFAULT NULL,
                trigger_count   INTEGER DEFAULT 0,
                created_at      TIMESTAMPTZ DEFAULT NOW()
            );
            CREATE INDEX IF NOT EXISTS idx_webhooks_active ON webhook_registry(active, created_at DESC);
        """)
        conn.commit()

        # ── Phase 9C — Model Cost Log ─────────────────────────────────────────
        cur.execute("""
            CREATE TABLE IF NOT EXISTS model_cost_log (
                id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
                model         TEXT NOT NULL,
                input_tokens  INTEGER DEFAULT 0,
                output_tokens INTEGER DEFAULT 0,
                cost_usd      FLOAT DEFAULT 0,
                source        TEXT DEFAULT 'chat',
                session_id    TEXT DEFAULT '',
                created_at    TIMESTAMPTZ DEFAULT NOW()
            );
            CREATE INDEX IF NOT EXISTS idx_model_cost_log_created ON model_cost_log(created_at DESC);
            CREATE INDEX IF NOT EXISTS idx_model_cost_log_model   ON model_cost_log(model, created_at DESC);
        """)
        conn.commit()

        # ── Phase 9D — Persistent Agent Goals ────────────────────────────────
        cur.execute("""
            CREATE TABLE IF NOT EXISTS agent_goals (
                id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
                agent_codename  TEXT NOT NULL,
                goal            TEXT NOT NULL,
                condition       TEXT NOT NULL,
                status          TEXT NOT NULL DEFAULT 'active',
                last_triggered  TIMESTAMPTZ DEFAULT NULL,
                trigger_count   INTEGER DEFAULT 0,
                created_at      TIMESTAMPTZ DEFAULT NOW()
            );
            CREATE INDEX IF NOT EXISTS idx_agent_goals_codename ON agent_goals(agent_codename, status);
            CREATE INDEX IF NOT EXISTS idx_agent_goals_active   ON agent_goals(status, created_at DESC);
        """)
        conn.commit()

        # ── Phase 9E — Telegram config ────────────────────────────────────────
        cur.execute("""
            CREATE TABLE IF NOT EXISTS telegram_config (
                id          SERIAL PRIMARY KEY,
                bot_token   TEXT DEFAULT '',
                chat_id     TEXT DEFAULT '',
                enabled     BOOLEAN DEFAULT FALSE,
                updated_at  TIMESTAMPTZ DEFAULT NOW()
            );
            INSERT INTO telegram_config (id) VALUES (1) ON CONFLICT DO NOTHING;
        """)
        conn.commit()

        # ── Phase 10A — Briefing config ───────────────────────────────────────
        cur.execute("""
            CREATE TABLE IF NOT EXISTS briefing_config (
                id                    INTEGER PRIMARY KEY DEFAULT 1,
                morning_enabled       BOOLEAN DEFAULT FALSE,
                morning_hour          INTEGER DEFAULT 2,
                morning_minute        INTEGER DEFAULT 0,
                evening_enabled       BOOLEAN DEFAULT FALSE,
                evening_hour          INTEGER DEFAULT 15,
                evening_minute        INTEGER DEFAULT 30,
                include_calendar      BOOLEAN DEFAULT TRUE,
                include_email         BOOLEAN DEFAULT TRUE,
                include_jobs          BOOLEAN DEFAULT TRUE,
                last_morning_sent_at  TIMESTAMPTZ,
                last_evening_sent_at  TIMESTAMPTZ,
                updated_at            TIMESTAMPTZ DEFAULT NOW()
            );
            INSERT INTO briefing_config (id) VALUES (1) ON CONFLICT DO NOTHING;
        """)
        conn.commit()

        # ── Phase 10A — Briefing history ──────────────────────────────────────
        cur.execute("""
            CREATE TABLE IF NOT EXISTS briefing_history (
                id           SERIAL PRIMARY KEY,
                type         TEXT NOT NULL,
                message      TEXT NOT NULL,
                sent_at      TIMESTAMPTZ DEFAULT NOW(),
                char_count   INTEGER DEFAULT 0,
                delivery_ok  BOOLEAN DEFAULT TRUE
            );
        """)
        conn.commit()

        # ── Phase 10B — Instant alert config ──────────────────────────────────
        cur.execute("""
            CREATE TABLE IF NOT EXISTS alert_config (
                id                INTEGER PRIMARY KEY DEFAULT 1,
                recruiter_email   BOOLEAN DEFAULT TRUE,
                interview_invite  BOOLEAN DEFAULT TRUE,
                job_rejection     BOOLEAN DEFAULT TRUE,
                offer_letter      BOOLEAN DEFAULT TRUE,
                action_required   BOOLEAN DEFAULT FALSE,
                important_email   BOOLEAN DEFAULT FALSE,
                updated_at        TIMESTAMPTZ DEFAULT NOW()
            );
            INSERT INTO alert_config (id) VALUES (1) ON CONFLICT DO NOTHING;
        """)
        conn.commit()

        # ── Phase 11A — Automation rules ─────────────────────────────────────────
        cur.execute("""
            CREATE TABLE IF NOT EXISTS automation_rules (
                id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
                name TEXT NOT NULL,
                trigger_event TEXT NOT NULL,
                conditions JSONB NOT NULL DEFAULT '[]',
                actions JSONB NOT NULL DEFAULT '[]',
                enabled BOOL NOT NULL DEFAULT TRUE,
                run_count INT NOT NULL DEFAULT 0,
                last_fired_at TIMESTAMPTZ DEFAULT NULL,
                created_at TIMESTAMPTZ DEFAULT NOW()
            );
            CREATE TABLE IF NOT EXISTS automation_history (
                id SERIAL PRIMARY KEY,
                rule_id UUID REFERENCES automation_rules(id) ON DELETE CASCADE,
                trigger_data JSONB,
                actions_fired JSONB,
                success BOOL NOT NULL DEFAULT TRUE,
                error_msg TEXT DEFAULT NULL,
                fired_at TIMESTAMPTZ DEFAULT NOW()
            );
        """)
        conn.commit()

        # ── Phase 11B — Knowledge base ────────────────────────────────────────
        cur.execute("""
            CREATE TABLE IF NOT EXISTS knowledge_items (
                id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
                title TEXT NOT NULL,
                content TEXT NOT NULL,
                source_type TEXT NOT NULL DEFAULT 'paste',
                source_url TEXT DEFAULT NULL,
                source_file TEXT DEFAULT NULL,
                tags TEXT[] DEFAULT '{}',
                embedding VECTOR(384) DEFAULT NULL,
                char_count INT NOT NULL DEFAULT 0,
                created_at TIMESTAMPTZ DEFAULT NOW(),
                updated_at TIMESTAMPTZ DEFAULT NOW()
            );
        """)
        conn.commit()

        # ── Phase 11C — Contacts CRM ──────────────────────────────────────────
        cur.execute("""
            CREATE TABLE IF NOT EXISTS contacts (
                id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
                name TEXT NOT NULL,
                company TEXT DEFAULT NULL,
                title TEXT DEFAULT NULL,
                email TEXT DEFAULT NULL,
                linkedin_url TEXT DEFAULT NULL,
                phone TEXT DEFAULT NULL,
                relationship_type TEXT DEFAULT 'recruiter',
                last_contact_at TIMESTAMPTZ DEFAULT NULL,
                notes TEXT DEFAULT '',
                tags TEXT[] DEFAULT '{}',
                created_at TIMESTAMPTZ DEFAULT NOW(),
                updated_at TIMESTAMPTZ DEFAULT NOW()
            );
        """)
        conn.commit()

        # ── Phase 21A — Interview Prep ────────────────────────────────────────
        cur.execute("""
            CREATE TABLE IF NOT EXISTS interview_prep_sessions (
                id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
                application_id UUID DEFAULT NULL,
                company        TEXT NOT NULL DEFAULT '',
                role           TEXT NOT NULL DEFAULT '',
                questions      JSONB DEFAULT '[]',
                created_at     TIMESTAMPTZ DEFAULT NOW()
            );

            CREATE TABLE IF NOT EXISTS interview_answers (
                id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
                session_id UUID REFERENCES interview_prep_sessions(id) ON DELETE CASCADE,
                question   TEXT NOT NULL,
                answer     TEXT NOT NULL,
                score      FLOAT DEFAULT 0,
                feedback   TEXT DEFAULT '',
                tips       JSONB DEFAULT '[]',
                created_at TIMESTAMPTZ DEFAULT NOW()
            );
        """)
        conn.commit()

        # ── Phase 21B — Focus Sessions ────────────────────────────────────────
        cur.execute("""
            CREATE TABLE IF NOT EXISTS focus_sessions (
                id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
                task_id          UUID DEFAULT NULL,
                task_title       TEXT DEFAULT '',
                duration_minutes INTEGER NOT NULL DEFAULT 25,
                actual_minutes   INTEGER DEFAULT 0,
                type             TEXT DEFAULT 'pomodoro',
                status           TEXT DEFAULT 'active',
                started_at       TIMESTAMPTZ DEFAULT NOW(),
                ended_at         TIMESTAMPTZ DEFAULT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_focus_started ON focus_sessions(started_at DESC);
        """)
        conn.commit()

        # ── Phase 22 — Goals, Digests, Mood ──────────────────────────────────
        cur.execute("""
            CREATE TABLE IF NOT EXISTS goals (
                id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
                title TEXT NOT NULL,
                description TEXT DEFAULT '',
                type TEXT DEFAULT 'quarterly',
                status TEXT DEFAULT 'active',
                target_date DATE DEFAULT NULL,
                created_at TIMESTAMPTZ DEFAULT NOW()
            );
            CREATE TABLE IF NOT EXISTS key_results (
                id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
                goal_id UUID REFERENCES goals(id) ON DELETE CASCADE,
                title TEXT NOT NULL,
                metric_type TEXT DEFAULT 'percent',
                current_value FLOAT DEFAULT 0,
                target_value FLOAT DEFAULT 100,
                unit TEXT DEFAULT '%',
                created_at TIMESTAMPTZ DEFAULT NOW()
            );
            CREATE TABLE IF NOT EXISTS weekly_digests (
                id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
                content TEXT NOT NULL,
                week_start DATE NOT NULL,
                generated_at TIMESTAMPTZ DEFAULT NOW()
            );
            CREATE TABLE IF NOT EXISTS mood_logs (
                id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
                energy INT NOT NULL CHECK (energy BETWEEN 1 AND 5),
                mood INT NOT NULL CHECK (mood BETWEEN 1 AND 5),
                note TEXT DEFAULT '',
                logged_at TIMESTAMPTZ DEFAULT NOW()
            );
            CREATE INDEX IF NOT EXISTS idx_mood_logged ON mood_logs(logged_at DESC);
        """)
        conn.commit()

        # Phase 22 — triage columns on notifications
        for sql in [
            "ALTER TABLE notifications ADD COLUMN IF NOT EXISTS triage_priority TEXT DEFAULT NULL",
            "ALTER TABLE notifications ADD COLUMN IF NOT EXISTS triage_action TEXT DEFAULT NULL",
        ]:
            try:
                cur.execute(sql)
                conn.commit()
            except Exception:
                conn.rollback()

        # ── Phase 23 — Task Priority Cache, Reading List, Sprints ────────────
        cur.execute("""
            CREATE TABLE IF NOT EXISTS task_priority_cache (
                task_id     UUID PRIMARY KEY,
                rank        INT DEFAULT 0,
                urgency     TEXT DEFAULT 'medium',
                reason      TEXT DEFAULT '',
                analyzed_at TIMESTAMPTZ DEFAULT NOW()
            );

            CREATE TABLE IF NOT EXISTS reading_list (
                id       UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
                url      TEXT NOT NULL,
                title    TEXT NOT NULL DEFAULT '',
                summary  TEXT DEFAULT '',
                tags     TEXT[] DEFAULT '{}',
                status   TEXT DEFAULT 'unread',
                added_at TIMESTAMPTZ DEFAULT NOW()
            );

            CREATE TABLE IF NOT EXISTS sprints (
                id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
                title      TEXT NOT NULL,
                goal       TEXT DEFAULT '',
                start_date DATE NOT NULL,
                end_date   DATE NOT NULL,
                status     TEXT DEFAULT 'active',
                created_at TIMESTAMPTZ DEFAULT NOW()
            );

            CREATE TABLE IF NOT EXISTS sprint_tasks (
                id        UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
                sprint_id UUID REFERENCES sprints(id) ON DELETE CASCADE,
                task_id   UUID DEFAULT NULL,
                title     TEXT NOT NULL,
                status    TEXT DEFAULT 'todo',
                added_at  TIMESTAMPTZ DEFAULT NOW()
            );
            CREATE INDEX IF NOT EXISTS idx_sprint_tasks_sprint ON sprint_tasks(sprint_id);
        """)
        conn.commit()

        # Phase 23 — followup column on job_applications
        for sql in [
            "ALTER TABLE job_applications ADD COLUMN IF NOT EXISTS last_followup_at TIMESTAMPTZ DEFAULT NULL",
        ]:
            try:
                cur.execute(sql)
                conn.commit()
            except Exception:
                conn.rollback()

        # ── Phase 24 — Offer Evaluations, Portfolio, Standup History ─────────
        cur.execute("""
            CREATE TABLE IF NOT EXISTS offer_evaluations (
                id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
                application_id UUID DEFAULT NULL,
                company TEXT NOT NULL DEFAULT '',
                role TEXT NOT NULL DEFAULT '',
                base_salary FLOAT DEFAULT 0,
                equity TEXT DEFAULT '',
                pto_days INT DEFAULT 0,
                remote_type TEXT DEFAULT 'hybrid',
                bonus FLOAT DEFAULT 0,
                other_perks TEXT DEFAULT '',
                score FLOAT DEFAULT 0,
                analysis TEXT DEFAULT '',
                pros JSONB DEFAULT '[]',
                cons JSONB DEFAULT '[]',
                created_at TIMESTAMPTZ DEFAULT NOW()
            );

            CREATE TABLE IF NOT EXISTS portfolio_items (
                id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
                name TEXT NOT NULL,
                description TEXT DEFAULT '',
                tech_stack TEXT[] DEFAULT '{}',
                github_url TEXT DEFAULT '',
                live_url TEXT DEFAULT '',
                pitch TEXT DEFAULT '',
                status TEXT DEFAULT 'active',
                created_at TIMESTAMPTZ DEFAULT NOW()
            );

            CREATE TABLE IF NOT EXISTS standup_history (
                id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
                content TEXT NOT NULL,
                generated_at TIMESTAMPTZ DEFAULT NOW()
            );

            CREATE TABLE IF NOT EXISTS code_chunks (
                id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
                workspace_root TEXT NOT NULL,
                file_path TEXT NOT NULL,
                symbol_name TEXT DEFAULT '',
                symbol_type TEXT DEFAULT '',
                start_line INT NOT NULL,
                end_line INT NOT NULL,
                content TEXT NOT NULL,
                embedding VECTOR(384),
                updated_at TIMESTAMPTZ DEFAULT NOW()
            );
            CREATE INDEX IF NOT EXISTS idx_code_chunks_emb
                ON code_chunks USING ivfflat (embedding vector_cosine_ops)
                WITH (lists = 50);
            CREATE INDEX IF NOT EXISTS idx_code_chunks_workspace
                ON code_chunks (workspace_root);
            CREATE INDEX IF NOT EXISTS idx_code_chunks_file
                ON code_chunks (workspace_root, file_path);
        """)
        conn.commit()

        # ── COOS HQ org graph: divisions, teams, floor/team/desk assignments ──
        cur.execute("""
            INSERT INTO divisions (id, name, label, order_index, map_theme)
            VALUES ('div-main', 'Main Division', 'COOS HQ — Floor 1', 0, 'office')
            ON CONFLICT (id) DO NOTHING
        """)
        cur.execute("""
            INSERT INTO divisions (id, name, label, order_index, map_theme)
            VALUES ('div-ops', 'Operations Division', 'COOS HQ — Floor 2', 1, 'office')
            ON CONFLICT (id) DO NOTHING
        """)
        cur.execute("""
            UPDATE departments
            SET division_id = 'div-main', floor_id = 'floor-1'
            WHERE division_id IS NULL OR floor_id IS NULL
        """)
        _floor2_depts = (
            'marketing', 'sales', 'finance', 'hr', 'analytics',
            'research', 'relations', 'creative', 'quality_assurance',
        )
        for dept_id in _floor2_depts:
            cur.execute(
                "UPDATE departments SET division_id = %s, floor_id = %s WHERE id = %s",
                ('div-ops', 'floor-2', dept_id),
            )
        cur.execute(
            "UPDATE agent_registry SET floor_id = %s WHERE department = ANY(%s)",
            ('floor-2', list(_floor2_depts)),
        )
        cur.execute("SELECT id, name FROM departments ORDER BY name")
        for dept_id, dept_name in cur.fetchall():
            cur.execute("""
                INSERT INTO teams (id, name, department_id, division_id, order_index)
                VALUES (%s, %s, %s, 'div-main', 0)
                ON CONFLICT (id) DO NOTHING
            """, (f"team_{dept_id}", f"{dept_name} Team", dept_id))
        cur.execute("""
            WITH ranked AS (
                SELECT agent_id, department,
                       ROW_NUMBER() OVER (PARTITION BY department ORDER BY level, name) - 1 AS slot
                FROM agent_registry
            )
            UPDATE agent_registry AS a
            SET floor_id = 'floor-1',
                team_id = 'team_' || ranked.department,
                desk_slot = ranked.slot
            FROM ranked
            WHERE a.agent_id = ranked.agent_id
              AND (a.team_id IS NULL OR a.floor_id IS NULL OR a.desk_slot IS NULL)
        """)
        conn.commit()

        cur.close()
        conn.close()
        log.info("All tables ready")

    except Exception as e:
        log.warning("Could not ensure tables", error=str(e))
