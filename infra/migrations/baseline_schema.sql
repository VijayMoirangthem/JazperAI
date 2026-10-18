--
-- PostgreSQL database dump
--


-- Dumped from database version 16.10 (Debian 16.10-1.pgdg12+1)
-- Dumped by pg_dump version 16.10 (Debian 16.10-1.pgdg12+1)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: pg_trgm; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;


--
-- Name: EXTENSION pg_trgm; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION pg_trgm IS 'text similarity measurement and index searching based on trigrams';


--
-- Name: uuid-ossp; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA public;


--
-- Name: EXTENSION "uuid-ossp"; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION "uuid-ossp" IS 'generate universally unique identifiers (UUIDs)';


--
-- Name: vector; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA public;


--
-- Name: EXTENSION vector; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION vector IS 'vector data type and ivfflat and hnsw access methods';


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: agent_actions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.agent_actions (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    agent_id text NOT NULL,
    action_type text NOT NULL,
    outcome text DEFAULT 'success'::text,
    duration_ms integer DEFAULT 0,
    input_tokens integer DEFAULT 0,
    output_tokens integer DEFAULT 0,
    cost_usd double precision DEFAULT 0,
    error_msg text DEFAULT ''::text,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: agent_communications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.agent_communications (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    from_agent text NOT NULL,
    to_agent text,
    subject text DEFAULT ''::text NOT NULL,
    payload jsonb DEFAULT '{}'::jsonb,
    status text DEFAULT 'sent'::text,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: agent_direct_chats; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.agent_direct_chats (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    agent_codename text NOT NULL,
    role text NOT NULL,
    content text NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT agent_direct_chats_role_check CHECK ((role = ANY (ARRAY['user'::text, 'assistant'::text])))
);


--
-- Name: agent_errors; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.agent_errors (
    error_id text NOT NULL,
    agent text NOT NULL,
    error_message text NOT NULL,
    traceback text DEFAULT ''::text,
    context jsonb DEFAULT '{}'::jsonb,
    "timestamp" text NOT NULL,
    resolved boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: agent_goals; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.agent_goals (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    agent_codename text NOT NULL,
    goal text NOT NULL,
    condition text NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    last_triggered timestamp with time zone,
    trigger_count integer DEFAULT 0,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: agent_memory; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.agent_memory (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    agent_codename text NOT NULL,
    key text NOT NULL,
    content text NOT NULL,
    category text DEFAULT 'observation'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: agent_performance_snapshots; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.agent_performance_snapshots (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    agent_id text NOT NULL,
    week_start date NOT NULL,
    tasks_completed integer DEFAULT 0,
    tasks_failed integer DEFAULT 0,
    avg_duration_ms double precision DEFAULT 0,
    total_cost_usd double precision DEFAULT 0,
    health_score double precision DEFAULT 0,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: agent_plans; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.agent_plans (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    title text NOT NULL,
    description text DEFAULT ''::text,
    agent text DEFAULT 'Jazper'::text NOT NULL,
    steps jsonb DEFAULT '[]'::jsonb NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: agent_registry; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.agent_registry (
    agent_id text NOT NULL,
    codename text NOT NULL,
    name text NOT NULL,
    version text DEFAULT '1.0.0'::text NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    department text NOT NULL,
    title text NOT NULL,
    level integer DEFAULT 3 NOT NULL,
    reports_to text,
    model text NOT NULL,
    temperature double precision DEFAULT 0.5,
    max_tokens integer DEFAULT 1000,
    tools_enabled text[] DEFAULT '{}'::text[],
    capabilities text[] DEFAULT '{}'::text[],
    system_prompt_override text,
    auto_approve_types text[] DEFAULT '{}'::text[],
    requires_approval_for text[] DEFAULT '{}'::text[],
    trust_tier text DEFAULT 'citizen'::text,
    voice_id text DEFAULT 'en-US-GuyNeural'::text,
    voice_prosody jsonb DEFAULT '{}'::jsonb,
    avatar_source text DEFAULT 'dicebear'::text,
    avatar_style text DEFAULT 'bottts'::text,
    avatar_seed text,
    avatar_custom_path text,
    avatar_emoji text DEFAULT '🤖'::text,
    badge_color text DEFAULT '#94a3b8'::text,
    description text DEFAULT ''::text,
    health_score double precision DEFAULT 100.0,
    tasks_completed integer DEFAULT 0,
    tasks_failed integer DEFAULT 0,
    last_active timestamp with time zone,
    meta jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    system_prompt text DEFAULT ''::text,
    team_id text,
    floor_id text,
    desk_slot integer
);


--
-- Name: alert_config; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.alert_config (
    id integer DEFAULT 1 NOT NULL,
    recruiter_email boolean DEFAULT true,
    interview_invite boolean DEFAULT true,
    job_rejection boolean DEFAULT true,
    offer_letter boolean DEFAULT true,
    action_required boolean DEFAULT false,
    important_email boolean DEFAULT false,
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: approval_requests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.approval_requests (
    id uuid NOT NULL,
    agent text NOT NULL,
    action_type text NOT NULL,
    description text DEFAULT ''::text NOT NULL,
    payload jsonb DEFAULT '{}'::jsonb,
    status text DEFAULT 'pending'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    resolved_at timestamp with time zone
);


--
-- Name: automation_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.automation_history (
    id integer NOT NULL,
    rule_id uuid,
    trigger_data jsonb,
    actions_fired jsonb,
    success boolean DEFAULT true NOT NULL,
    error_msg text,
    fired_at timestamp with time zone DEFAULT now()
);


--
-- Name: automation_history_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.automation_history_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: automation_history_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.automation_history_id_seq OWNED BY public.automation_history.id;


--
-- Name: automation_rules; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.automation_rules (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    name text NOT NULL,
    trigger_event text NOT NULL,
    conditions jsonb DEFAULT '[]'::jsonb NOT NULL,
    actions jsonb DEFAULT '[]'::jsonb NOT NULL,
    enabled boolean DEFAULT true NOT NULL,
    run_count integer DEFAULT 0 NOT NULL,
    last_fired_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: biz_clients; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.biz_clients (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    name text NOT NULL,
    contact_name text DEFAULT ''::text,
    contact_email text DEFAULT ''::text,
    phone text DEFAULT ''::text,
    status text DEFAULT 'prospect'::text NOT NULL,
    notes text DEFAULT ''::text,
    source_lead_id uuid,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: biz_expenses; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.biz_expenses (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    project_id uuid,
    description text NOT NULL,
    amount double precision DEFAULT 0 NOT NULL,
    category text DEFAULT 'other'::text,
    expense_date date,
    notes text DEFAULT ''::text,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: biz_invoice_line_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.biz_invoice_line_items (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    invoice_id uuid NOT NULL,
    description text NOT NULL,
    quantity double precision DEFAULT 1 NOT NULL,
    unit_price double precision DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: biz_invoices; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.biz_invoices (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    client_id uuid NOT NULL,
    project_id uuid,
    invoice_number text NOT NULL,
    status text DEFAULT 'draft'::text NOT NULL,
    issue_date date,
    due_date date,
    paid_date date,
    notes text DEFAULT ''::text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: biz_project_assignments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.biz_project_assignments (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    project_id uuid NOT NULL,
    team_member_id uuid NOT NULL,
    role_on_project text DEFAULT ''::text,
    assigned_at timestamp with time zone DEFAULT now()
);


--
-- Name: biz_projects; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.biz_projects (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    client_id uuid NOT NULL,
    title text NOT NULL,
    description text DEFAULT ''::text,
    status text DEFAULT 'planning'::text NOT NULL,
    start_date date,
    due_date date,
    notes text DEFAULT ''::text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: biz_team_members; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.biz_team_members (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    name text NOT NULL,
    email text DEFAULT ''::text,
    role text DEFAULT ''::text,
    member_type text DEFAULT 'employee'::text NOT NULL,
    rate double precision DEFAULT 0,
    rate_unit text DEFAULT 'hourly'::text,
    status text DEFAULT 'active'::text NOT NULL,
    start_date date,
    end_date date,
    notes text DEFAULT ''::text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: briefing_config; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.briefing_config (
    id integer DEFAULT 1 NOT NULL,
    morning_enabled boolean DEFAULT false,
    morning_hour integer DEFAULT 2,
    morning_minute integer DEFAULT 0,
    evening_enabled boolean DEFAULT false,
    evening_hour integer DEFAULT 15,
    evening_minute integer DEFAULT 30,
    include_calendar boolean DEFAULT true,
    include_email boolean DEFAULT true,
    include_jobs boolean DEFAULT true,
    last_morning_sent_at timestamp with time zone,
    last_evening_sent_at timestamp with time zone,
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: briefing_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.briefing_history (
    id integer NOT NULL,
    type text NOT NULL,
    message text NOT NULL,
    sent_at timestamp with time zone DEFAULT now(),
    char_count integer DEFAULT 0,
    delivery_ok boolean DEFAULT true
);


--
-- Name: briefing_history_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.briefing_history_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: briefing_history_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.briefing_history_id_seq OWNED BY public.briefing_history.id;


--
-- Name: chat_messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.chat_messages (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    session_id uuid,
    role text NOT NULL,
    content text NOT NULL,
    meta jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: chat_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.chat_sessions (
    id uuid NOT NULL,
    title text DEFAULT 'New Chat'::text NOT NULL,
    expires_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: code_chunks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.code_chunks (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    workspace_root text NOT NULL,
    file_path text NOT NULL,
    symbol_name text DEFAULT ''::text,
    symbol_type text DEFAULT ''::text,
    start_line integer NOT NULL,
    end_line integer NOT NULL,
    content text NOT NULL,
    embedding public.vector(384),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: contacts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.contacts (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    name text NOT NULL,
    company text,
    title text,
    email text,
    linkedin_url text,
    phone text,
    relationship_type text DEFAULT 'recruiter'::text,
    last_contact_at timestamp with time zone,
    notes text DEFAULT ''::text,
    tags text[] DEFAULT '{}'::text[],
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    outreach_status text DEFAULT 'none'::text,
    outreach_notes text DEFAULT ''::text,
    outreach_at timestamp with time zone
);


--
-- Name: conversations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.conversations (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    user_id uuid,
    title text DEFAULT 'New Conversation'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: core_memories; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.core_memories (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    content text NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: credentials; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.credentials (
    portal text NOT NULL,
    token_data jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: cron_jobs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.cron_jobs (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    name text NOT NULL,
    worker_type text NOT NULL,
    schedule text NOT NULL,
    enabled boolean DEFAULT true,
    config jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    owner_agent text,
    description text DEFAULT ''::text
);


--
-- Name: db_change_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.db_change_log (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    agent_name text NOT NULL,
    table_name text NOT NULL,
    operation text DEFAULT 'UPDATE'::text NOT NULL,
    row_id text DEFAULT ''::text NOT NULL,
    before_json jsonb,
    after_json jsonb,
    sql_hint text DEFAULT ''::text,
    created_at timestamp with time zone DEFAULT now(),
    rolled_back_at timestamp with time zone,
    rolled_back_by text
);


--
-- Name: departments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.departments (
    id text NOT NULL,
    name text NOT NULL,
    description text DEFAULT ''::text,
    head_agent text,
    enabled boolean DEFAULT true,
    budget_daily_usd double precision DEFAULT 5.0,
    budget_used_today double precision DEFAULT 0.0,
    badge_color text DEFAULT '#94a3b8'::text,
    floor_position jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now(),
    division_id text,
    floor_id text
);


--
-- Name: dept_direct_chats; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.dept_direct_chats (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    dept_id text NOT NULL,
    role text NOT NULL,
    agent_codename text,
    content text NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT dept_direct_chats_role_check CHECK ((role = ANY (ARRAY['user'::text, 'agent'::text])))
);


--
-- Name: divisions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.divisions (
    id text NOT NULL,
    name text NOT NULL,
    label text NOT NULL,
    order_index integer DEFAULT 0,
    map_theme text DEFAULT 'office'::text,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: evolution_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.evolution_log (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    agent_codename text NOT NULL,
    action_type text NOT NULL,
    target text DEFAULT ''::text,
    description text DEFAULT ''::text,
    payload jsonb DEFAULT '{}'::jsonb,
    outcome text DEFAULT 'success'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: extracted_memories; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.extracted_memories (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    content text NOT NULL,
    session_id text,
    created_at timestamp with time zone DEFAULT now(),
    embedding public.vector(384)
);


--
-- Name: focus_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.focus_sessions (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    task_id uuid,
    task_title text DEFAULT ''::text,
    duration_minutes integer DEFAULT 25 NOT NULL,
    actual_minutes integer DEFAULT 0,
    type text DEFAULT 'pomodoro'::text,
    status text DEFAULT 'active'::text,
    started_at timestamp with time zone DEFAULT now(),
    ended_at timestamp with time zone
);


--
-- Name: gmail_tokens; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.gmail_tokens (
    email text NOT NULL,
    token_data jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: goals; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.goals (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    title text NOT NULL,
    description text DEFAULT ''::text,
    type text DEFAULT 'quarterly'::text,
    status text DEFAULT 'active'::text,
    target_date date,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: habit_completions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.habit_completions (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    habit_id uuid,
    completed_date date NOT NULL
);


--
-- Name: habits; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.habits (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    title text NOT NULL,
    emoji text DEFAULT '✅'::text,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: interview_answers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.interview_answers (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    session_id uuid,
    question text NOT NULL,
    answer text NOT NULL,
    score double precision DEFAULT 0,
    feedback text DEFAULT ''::text,
    tips jsonb DEFAULT '[]'::jsonb,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: interview_prep_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.interview_prep_sessions (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    application_id uuid,
    company text DEFAULT ''::text NOT NULL,
    role text DEFAULT ''::text NOT NULL,
    questions jsonb DEFAULT '[]'::jsonb,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: it_department_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.it_department_log (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    ticket_id uuid NOT NULL,
    type text NOT NULL,
    status text DEFAULT 'open'::text NOT NULL,
    trigger_text text DEFAULT ''::text,
    traceback text DEFAULT ''::text,
    affected_files text[] DEFAULT '{}'::text[],
    diagnosis jsonb DEFAULT '{}'::jsonb,
    proposed_changes jsonb DEFAULT '[]'::jsonb,
    new_files jsonb DEFAULT '[]'::jsonb,
    test_results jsonb DEFAULT '{}'::jsonb,
    user_approved boolean DEFAULT false,
    applied boolean DEFAULT false,
    resolution_note text DEFAULT ''::text,
    created_at timestamp with time zone DEFAULT now(),
    resolved_at timestamp with time zone,
    CONSTRAINT it_department_log_type_check CHECK ((type = ANY (ARRAY['repair'::text, 'create'::text])))
);


--
-- Name: jazper_autonomous_actions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.jazper_autonomous_actions (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    category_id text NOT NULL,
    action_taken text NOT NULL,
    reasoning text NOT NULL,
    outcome text,
    vj_reviewed boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT now(),
    vetoed boolean DEFAULT false
);


--
-- Name: jazper_autonomy; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.jazper_autonomy (
    category_id text NOT NULL,
    category text NOT NULL,
    description text NOT NULL,
    enabled boolean DEFAULT false,
    risk_level text DEFAULT 'low'::text,
    enabled_at timestamp with time zone,
    last_used timestamp with time zone,
    use_count integer DEFAULT 0
);


--
-- Name: job_applications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.job_applications (
    id text NOT NULL,
    company text NOT NULL,
    title text NOT NULL,
    url text,
    location text,
    work_mode text,
    status text DEFAULT 'applied'::text,
    applied_at timestamp with time zone DEFAULT now(),
    cover_letter_name text,
    easy_apply boolean DEFAULT true,
    notes text DEFAULT ''::text,
    email_thread_id text,
    run_id integer,
    cover_letter text,
    last_followup_at timestamp with time zone
);


--
-- Name: job_apply_profile; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.job_apply_profile (
    id integer NOT NULL,
    target_roles text[] DEFAULT '{}'::text[],
    work_modes text[] DEFAULT '{remote}'::text[],
    locations text[] DEFAULT '{}'::text[],
    salary_min integer DEFAULT 0,
    salary_max integer DEFAULT 0,
    experience_years integer DEFAULT 0,
    skills text[] DEFAULT '{}'::text[],
    blacklist_companies text[] DEFAULT '{}'::text[],
    resume_path text DEFAULT ''::text,
    daily_limit integer DEFAULT 5,
    auto_apply_enabled boolean DEFAULT false,
    auto_apply_hour integer DEFAULT 9,
    linkedin_email text DEFAULT ''::text,
    chrome_profile_path text DEFAULT ''::text,
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: job_apply_profile_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.job_apply_profile_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: job_apply_profile_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.job_apply_profile_id_seq OWNED BY public.job_apply_profile.id;


--
-- Name: job_apply_runs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.job_apply_runs (
    id integer NOT NULL,
    started_at timestamp with time zone DEFAULT now(),
    completed_at timestamp with time zone,
    jobs_found integer DEFAULT 0,
    jobs_applied integer DEFAULT 0,
    jobs_skipped integer DEFAULT 0,
    status text DEFAULT 'running'::text,
    error_msg text DEFAULT ''::text,
    run_log text DEFAULT ''::text
);


--
-- Name: job_apply_runs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.job_apply_runs_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: job_apply_runs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.job_apply_runs_id_seq OWNED BY public.job_apply_runs.id;


--
-- Name: job_cover_letters; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.job_cover_letters (
    id integer NOT NULL,
    name text NOT NULL,
    content text NOT NULL,
    is_default boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: job_cover_letters_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.job_cover_letters_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: job_cover_letters_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.job_cover_letters_id_seq OWNED BY public.job_cover_letters.id;


--
-- Name: job_radar_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.job_radar_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    title text NOT NULL,
    company text DEFAULT ''::text,
    location text DEFAULT ''::text,
    url text DEFAULT ''::text,
    relevance double precision DEFAULT 0.5,
    status text DEFAULT 'new'::text,
    matched_at timestamp with time zone DEFAULT now()
);


--
-- Name: job_runs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.job_runs (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    cron_job_id uuid,
    status text DEFAULT 'pending'::text NOT NULL,
    started_at timestamp with time zone DEFAULT now(),
    finished_at timestamp with time zone,
    result jsonb DEFAULT '{}'::jsonb,
    log text DEFAULT ''::text
);


--
-- Name: job_screening_answers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.job_screening_answers (
    id integer NOT NULL,
    question text NOT NULL,
    answer text NOT NULL,
    category text DEFAULT 'general'::text,
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: job_screening_answers_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.job_screening_answers_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: job_screening_answers_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.job_screening_answers_id_seq OWNED BY public.job_screening_answers.id;


--
-- Name: key_results; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.key_results (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    goal_id uuid,
    title text NOT NULL,
    metric_type text DEFAULT 'percent'::text,
    current_value double precision DEFAULT 0,
    target_value double precision DEFAULT 100,
    unit text DEFAULT '%'::text,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: knowledge_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.knowledge_items (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    title text NOT NULL,
    content text NOT NULL,
    source_type text DEFAULT 'paste'::text NOT NULL,
    source_url text,
    source_file text,
    tags text[] DEFAULT '{}'::text[],
    embedding public.vector(384) DEFAULT NULL::public.vector,
    char_count integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: mail_accounts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.mail_accounts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    provider text NOT NULL,
    address text NOT NULL,
    project text DEFAULT ''::text NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    last_ok_at timestamp with time zone,
    last_attempt_at timestamp with time zone,
    last_error text DEFAULT ''::text NOT NULL,
    config jsonb DEFAULT '{}'::jsonb NOT NULL,
    secret_enc text DEFAULT ''::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT mail_accounts_provider_check CHECK ((provider = ANY (ARRAY['gmail'::text, 'imap'::text])))
);


--
-- Name: mail_attachments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.mail_attachments (
    id bigint NOT NULL,
    message_id bigint NOT NULL,
    filename text DEFAULT ''::text NOT NULL,
    mime text DEFAULT ''::text NOT NULL,
    size bigint DEFAULT 0 NOT NULL,
    storage_key text
);


--
-- Name: mail_attachments_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.mail_attachments_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: mail_attachments_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.mail_attachments_id_seq OWNED BY public.mail_attachments.id;


--
-- Name: mail_messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.mail_messages (
    id bigint NOT NULL,
    account_id uuid NOT NULL,
    provider_msg_id text NOT NULL,
    thread_id text DEFAULT ''::text NOT NULL,
    from_addr text DEFAULT ''::text NOT NULL,
    to_addrs text[] DEFAULT '{}'::text[] NOT NULL,
    subject text DEFAULT ''::text NOT NULL,
    date timestamp with time zone,
    snippet text DEFAULT ''::text NOT NULL,
    body_text text DEFAULT ''::text NOT NULL,
    labels text[] DEFAULT '{}'::text[] NOT NULL,
    has_attachments boolean DEFAULT false NOT NULL,
    classification text DEFAULT ''::text NOT NULL,
    importance smallint DEFAULT 0 NOT NULL,
    importance_reason text DEFAULT ''::text NOT NULL,
    importance_source text DEFAULT ''::text NOT NULL,
    deleted boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    search tsvector GENERATED ALWAYS AS (to_tsvector('simple'::regconfig, ((((COALESCE(subject, ''::text) || ' '::text) || COALESCE(from_addr, ''::text)) || ' '::text) || COALESCE(body_text, ''::text)))) STORED
);


--
-- Name: mail_messages_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.mail_messages_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: mail_messages_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.mail_messages_id_seq OWNED BY public.mail_messages.id;


--
-- Name: mail_rules; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.mail_rules (
    id integer NOT NULL,
    kind text NOT NULL,
    pattern text NOT NULL,
    importance smallint NOT NULL,
    category text DEFAULT ''::text NOT NULL,
    reason text DEFAULT ''::text NOT NULL,
    enabled boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT mail_rules_kind_check CHECK ((kind = ANY (ARRAY['sender'::text, 'domain'::text, 'keyword'::text])))
);


--
-- Name: mail_rules_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.mail_rules_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: mail_rules_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.mail_rules_id_seq OWNED BY public.mail_rules.id;


--
-- Name: mail_sync_state; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.mail_sync_state (
    account_id uuid NOT NULL,
    folder text DEFAULT 'INBOX'::text NOT NULL,
    cursor jsonb DEFAULT '{}'::jsonb NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: memories; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.memories (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    content text NOT NULL,
    embedding public.vector(1536),
    metadata jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.messages (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    conversation_id uuid,
    role text NOT NULL,
    content text NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT messages_role_check CHECK ((role = ANY (ARRAY['user'::text, 'assistant'::text, 'system'::text])))
);


--
-- Name: model_cost_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.model_cost_log (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    model text NOT NULL,
    input_tokens integer DEFAULT 0,
    output_tokens integer DEFAULT 0,
    cost_usd double precision DEFAULT 0,
    source text DEFAULT 'chat'::text,
    session_id text DEFAULT ''::text,
    created_at timestamp with time zone DEFAULT now(),
    agent text DEFAULT ''::text,
    status text DEFAULT 'ok'::text,
    error text DEFAULT ''::text,
    estimated boolean DEFAULT false,
    duration_ms integer DEFAULT 0
);


--
-- Name: mood_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.mood_logs (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    energy integer NOT NULL,
    mood integer NOT NULL,
    note text DEFAULT ''::text,
    logged_at timestamp with time zone DEFAULT now(),
    CONSTRAINT mood_logs_energy_check CHECK (((energy >= 1) AND (energy <= 5))),
    CONSTRAINT mood_logs_mood_check CHECK (((mood >= 1) AND (mood <= 5)))
);


--
-- Name: notifications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notifications (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    title text NOT NULL,
    body text DEFAULT ''::text,
    type text DEFAULT 'info'::text NOT NULL,
    read boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT now(),
    job_run_id uuid,
    triage_priority text,
    triage_action text,
    metadata jsonb DEFAULT '{}'::jsonb
);


--
-- Name: offer_evaluations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.offer_evaluations (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    application_id uuid,
    company text DEFAULT ''::text NOT NULL,
    role text DEFAULT ''::text NOT NULL,
    base_salary double precision DEFAULT 0,
    equity text DEFAULT ''::text,
    pto_days integer DEFAULT 0,
    remote_type text DEFAULT 'hybrid'::text,
    bonus double precision DEFAULT 0,
    other_perks text DEFAULT ''::text,
    score double precision DEFAULT 0,
    analysis text DEFAULT ''::text,
    pros jsonb DEFAULT '[]'::jsonb,
    cons jsonb DEFAULT '[]'::jsonb,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: phases_messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.phases_messages (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    session_id uuid,
    role text NOT NULL,
    personality_id text,
    personality_name text,
    personality_emoji text,
    content text NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: phases_profile; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.phases_profile (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    singleton boolean DEFAULT true,
    detected_gender text DEFAULT ''::text,
    detected_pitch_hz double precision DEFAULT 0,
    detected_age_range text DEFAULT ''::text,
    base_voice text DEFAULT ''::text,
    openness integer DEFAULT 50,
    conscientiousness integer DEFAULT 50,
    extraversion integer DEFAULT 50,
    agreeableness integer DEFAULT 50,
    neuroticism integer DEFAULT 50,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: phases_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.phases_sessions (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    title text DEFAULT 'Phases Session'::text NOT NULL,
    mode text DEFAULT 'solo'::text NOT NULL,
    personality_ids text[] DEFAULT '{}'::text[],
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: phases_voice_config; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.phases_voice_config (
    personality_id text NOT NULL,
    voice_id text NOT NULL,
    prosody text DEFAULT ''::text,
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: portfolio_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.portfolio_items (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    name text NOT NULL,
    description text DEFAULT ''::text,
    tech_stack text[] DEFAULT '{}'::text[],
    github_url text DEFAULT ''::text,
    live_url text DEFAULT ''::text,
    pitch text DEFAULT ''::text,
    status text DEFAULT 'active'::text,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: reading_list; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.reading_list (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    url text NOT NULL,
    title text DEFAULT ''::text NOT NULL,
    summary text DEFAULT ''::text,
    tags text[] DEFAULT '{}'::text[],
    status text DEFAULT 'unread'::text,
    added_at timestamp with time zone DEFAULT now()
);


--
-- Name: reminders; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.reminders (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    title text NOT NULL,
    body text DEFAULT ''::text,
    remind_at timestamp with time zone NOT NULL,
    related_type text DEFAULT ''::text,
    related_id text DEFAULT ''::text,
    status text DEFAULT 'pending'::text,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: response_templates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.response_templates (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    category text DEFAULT 'custom'::text,
    body text DEFAULT ''::text NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: roadmap_notes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.roadmap_notes (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    title text DEFAULT 'Roadmap Note'::text NOT NULL,
    messages jsonb DEFAULT '[]'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: semantic_memories; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.semantic_memories (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    content text NOT NULL,
    embedding public.vector(384),
    metadata jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: shared_memory; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.shared_memory (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    key text NOT NULL,
    value text NOT NULL,
    writing_agent text DEFAULT 'system'::text NOT NULL,
    tags text[] DEFAULT '{}'::text[],
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: social_scheduled_posts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.social_scheduled_posts (
    id text NOT NULL,
    scheduled_at timestamp with time zone NOT NULL,
    payload jsonb NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    result jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: sprint_tasks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sprint_tasks (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    sprint_id uuid,
    task_id uuid,
    title text NOT NULL,
    status text DEFAULT 'todo'::text,
    added_at timestamp with time zone DEFAULT now()
);


--
-- Name: sprints; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sprints (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    title text NOT NULL,
    goal text DEFAULT ''::text,
    start_date date NOT NULL,
    end_date date NOT NULL,
    status text DEFAULT 'active'::text,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: standup_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.standup_history (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    content text NOT NULL,
    generated_at timestamp with time zone DEFAULT now()
);


--
-- Name: task_priority_cache; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.task_priority_cache (
    task_id uuid NOT NULL,
    rank integer DEFAULT 0,
    urgency text DEFAULT 'medium'::text,
    reason text DEFAULT ''::text,
    analyzed_at timestamp with time zone DEFAULT now()
);


--
-- Name: tasks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tasks (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    title text NOT NULL,
    type text DEFAULT 'general'::text NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    payload jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    notes text DEFAULT ''::text,
    priority text DEFAULT 'medium'::text NOT NULL,
    due_at timestamp with time zone,
    CONSTRAINT tasks_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'running'::text, 'completed'::text, 'failed'::text])))
);


--
-- Name: teams; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.teams (
    id text NOT NULL,
    name text NOT NULL,
    department_id text NOT NULL,
    division_id text,
    order_index integer DEFAULT 0,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: telegram_config; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.telegram_config (
    id integer NOT NULL,
    bot_token text DEFAULT ''::text,
    chat_id text DEFAULT ''::text,
    enabled boolean DEFAULT false,
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: telegram_config_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.telegram_config_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: telegram_config_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.telegram_config_id_seq OWNED BY public.telegram_config.id;


--
-- Name: user_profile; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_profile (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    full_name text DEFAULT ''::text,
    email text DEFAULT ''::text,
    phone text DEFAULT ''::text,
    resume_text text DEFAULT ''::text,
    skills text[] DEFAULT '{}'::text[],
    preferences jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    location text DEFAULT ''::text,
    experience_years text DEFAULT ''::text,
    availability text DEFAULT ''::text,
    work_type text DEFAULT ''::text,
    salary_expectation text DEFAULT ''::text,
    sections jsonb DEFAULT '{}'::jsonb,
    resume_filename text,
    resume_updated_at timestamp with time zone
);


--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.users (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    email text NOT NULL,
    name text NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: voice_journal; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.voice_journal (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    transcription text DEFAULT ''::text NOT NULL,
    duration_seconds double precision DEFAULT 0,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: webhook_registry; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.webhook_registry (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    name text NOT NULL,
    secret text DEFAULT ''::text NOT NULL,
    event_name text DEFAULT 'generic'::text NOT NULL,
    agent_codename text DEFAULT 'jazper'::text NOT NULL,
    chain_template text DEFAULT ''::text NOT NULL,
    active boolean DEFAULT true,
    last_triggered timestamp with time zone,
    trigger_count integer DEFAULT 0,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: weekly_digests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.weekly_digests (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    content text NOT NULL,
    week_start date NOT NULL,
    generated_at timestamp with time zone DEFAULT now()
);


--
-- Name: ws_notifications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ws_notifications (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    project_id uuid,
    task_id uuid,
    kind text NOT NULL,
    message text NOT NULL,
    read boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: ws_projects; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ws_projects (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    name text NOT NULL,
    path text NOT NULL,
    repo_url text DEFAULT ''::text,
    description text DEFAULT ''::text,
    stack text DEFAULT ''::text,
    default_agent text DEFAULT 'forge'::text NOT NULL,
    autopilot boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    allow_git_init boolean DEFAULT false NOT NULL,
    verify_cmd text DEFAULT ''::text,
    verify_timeout_sec integer DEFAULT 300 NOT NULL,
    approval_policy text DEFAULT 'ask'::text,
    team_roles jsonb DEFAULT '{}'::jsonb,
    pipeline text DEFAULT 'single'::text,
    max_parallel integer DEFAULT 1 NOT NULL
);


--
-- Name: ws_task_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ws_task_events (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    task_id uuid NOT NULL,
    kind text DEFAULT 'activity'::text NOT NULL,
    actor text DEFAULT ''::text,
    message text NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: ws_tasks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ws_tasks (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    project_id uuid NOT NULL,
    seq integer NOT NULL,
    title text NOT NULL,
    description text DEFAULT ''::text,
    type text DEFAULT 'FEATURE'::text NOT NULL,
    category text DEFAULT 'DEVELOPMENT'::text NOT NULL,
    status text DEFAULT 'TODO'::text NOT NULL,
    priority text DEFAULT 'MEDIUM'::text NOT NULL,
    assignee_agent text DEFAULT ''::text,
    sprint text DEFAULT ''::text,
    effort text DEFAULT ''::text,
    tags text[] DEFAULT '{}'::text[],
    due_date date,
    auto_run boolean DEFAULT true NOT NULL,
    run_state text DEFAULT 'idle'::text NOT NULL,
    result_summary text DEFAULT ''::text,
    source text DEFAULT 'manual'::text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    completed_at timestamp with time zone,
    branch text DEFAULT ''::text,
    base_branch text DEFAULT ''::text,
    commit_sha text DEFAULT ''::text,
    diff_stat text DEFAULT ''::text,
    diff_text text DEFAULT ''::text,
    verified boolean,
    verify_output text DEFAULT ''::text,
    parent_id uuid,
    stage text DEFAULT ''::text,
    blocked_by text[] DEFAULT '{}'::uuid[],
    github_issue_number integer,
    github_issue_url text DEFAULT ''::text,
    pr_url text DEFAULT ''::text
);


--
-- Name: automation_history id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.automation_history ALTER COLUMN id SET DEFAULT nextval('public.automation_history_id_seq'::regclass);


--
-- Name: briefing_history id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.briefing_history ALTER COLUMN id SET DEFAULT nextval('public.briefing_history_id_seq'::regclass);


--
-- Name: job_apply_profile id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.job_apply_profile ALTER COLUMN id SET DEFAULT nextval('public.job_apply_profile_id_seq'::regclass);


--
-- Name: job_apply_runs id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.job_apply_runs ALTER COLUMN id SET DEFAULT nextval('public.job_apply_runs_id_seq'::regclass);


--
-- Name: job_cover_letters id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.job_cover_letters ALTER COLUMN id SET DEFAULT nextval('public.job_cover_letters_id_seq'::regclass);


--
-- Name: job_screening_answers id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.job_screening_answers ALTER COLUMN id SET DEFAULT nextval('public.job_screening_answers_id_seq'::regclass);


--
-- Name: mail_attachments id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mail_attachments ALTER COLUMN id SET DEFAULT nextval('public.mail_attachments_id_seq'::regclass);


--
-- Name: mail_messages id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mail_messages ALTER COLUMN id SET DEFAULT nextval('public.mail_messages_id_seq'::regclass);


--
-- Name: mail_rules id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mail_rules ALTER COLUMN id SET DEFAULT nextval('public.mail_rules_id_seq'::regclass);


--
-- Name: telegram_config id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.telegram_config ALTER COLUMN id SET DEFAULT nextval('public.telegram_config_id_seq'::regclass);


--
-- Name: agent_actions agent_actions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_actions
    ADD CONSTRAINT agent_actions_pkey PRIMARY KEY (id);


--
-- Name: agent_communications agent_communications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_communications
    ADD CONSTRAINT agent_communications_pkey PRIMARY KEY (id);


--
-- Name: agent_direct_chats agent_direct_chats_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_direct_chats
    ADD CONSTRAINT agent_direct_chats_pkey PRIMARY KEY (id);


--
-- Name: agent_errors agent_errors_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_errors
    ADD CONSTRAINT agent_errors_pkey PRIMARY KEY (error_id);


--
-- Name: agent_goals agent_goals_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_goals
    ADD CONSTRAINT agent_goals_pkey PRIMARY KEY (id);


--
-- Name: agent_memory agent_memory_agent_codename_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_memory
    ADD CONSTRAINT agent_memory_agent_codename_key_key UNIQUE (agent_codename, key);


--
-- Name: agent_memory agent_memory_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_memory
    ADD CONSTRAINT agent_memory_pkey PRIMARY KEY (id);


--
-- Name: agent_performance_snapshots agent_performance_snapshots_agent_id_week_start_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_performance_snapshots
    ADD CONSTRAINT agent_performance_snapshots_agent_id_week_start_key UNIQUE (agent_id, week_start);


--
-- Name: agent_performance_snapshots agent_performance_snapshots_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_performance_snapshots
    ADD CONSTRAINT agent_performance_snapshots_pkey PRIMARY KEY (id);


--
-- Name: agent_plans agent_plans_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_plans
    ADD CONSTRAINT agent_plans_pkey PRIMARY KEY (id);


--
-- Name: agent_registry agent_registry_codename_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_registry
    ADD CONSTRAINT agent_registry_codename_key UNIQUE (codename);


--
-- Name: agent_registry agent_registry_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_registry
    ADD CONSTRAINT agent_registry_pkey PRIMARY KEY (agent_id);


--
-- Name: alert_config alert_config_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.alert_config
    ADD CONSTRAINT alert_config_pkey PRIMARY KEY (id);


--
-- Name: approval_requests approval_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.approval_requests
    ADD CONSTRAINT approval_requests_pkey PRIMARY KEY (id);


--
-- Name: automation_history automation_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.automation_history
    ADD CONSTRAINT automation_history_pkey PRIMARY KEY (id);


--
-- Name: automation_rules automation_rules_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.automation_rules
    ADD CONSTRAINT automation_rules_pkey PRIMARY KEY (id);


--
-- Name: biz_clients biz_clients_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.biz_clients
    ADD CONSTRAINT biz_clients_pkey PRIMARY KEY (id);


--
-- Name: biz_expenses biz_expenses_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.biz_expenses
    ADD CONSTRAINT biz_expenses_pkey PRIMARY KEY (id);


--
-- Name: biz_invoice_line_items biz_invoice_line_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.biz_invoice_line_items
    ADD CONSTRAINT biz_invoice_line_items_pkey PRIMARY KEY (id);


--
-- Name: biz_invoices biz_invoices_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.biz_invoices
    ADD CONSTRAINT biz_invoices_pkey PRIMARY KEY (id);


--
-- Name: biz_project_assignments biz_project_assignments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.biz_project_assignments
    ADD CONSTRAINT biz_project_assignments_pkey PRIMARY KEY (id);


--
-- Name: biz_project_assignments biz_project_assignments_project_id_team_member_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.biz_project_assignments
    ADD CONSTRAINT biz_project_assignments_project_id_team_member_id_key UNIQUE (project_id, team_member_id);


--
-- Name: biz_projects biz_projects_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.biz_projects
    ADD CONSTRAINT biz_projects_pkey PRIMARY KEY (id);


--
-- Name: biz_team_members biz_team_members_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.biz_team_members
    ADD CONSTRAINT biz_team_members_pkey PRIMARY KEY (id);


--
-- Name: briefing_config briefing_config_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.briefing_config
    ADD CONSTRAINT briefing_config_pkey PRIMARY KEY (id);


--
-- Name: briefing_history briefing_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.briefing_history
    ADD CONSTRAINT briefing_history_pkey PRIMARY KEY (id);


--
-- Name: chat_messages chat_messages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_messages
    ADD CONSTRAINT chat_messages_pkey PRIMARY KEY (id);


--
-- Name: chat_sessions chat_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_sessions
    ADD CONSTRAINT chat_sessions_pkey PRIMARY KEY (id);


--
-- Name: code_chunks code_chunks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.code_chunks
    ADD CONSTRAINT code_chunks_pkey PRIMARY KEY (id);


--
-- Name: contacts contacts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contacts
    ADD CONSTRAINT contacts_pkey PRIMARY KEY (id);


--
-- Name: conversations conversations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversations
    ADD CONSTRAINT conversations_pkey PRIMARY KEY (id);


--
-- Name: core_memories core_memories_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.core_memories
    ADD CONSTRAINT core_memories_pkey PRIMARY KEY (id);


--
-- Name: credentials credentials_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.credentials
    ADD CONSTRAINT credentials_pkey PRIMARY KEY (portal);


--
-- Name: cron_jobs cron_jobs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cron_jobs
    ADD CONSTRAINT cron_jobs_pkey PRIMARY KEY (id);


--
-- Name: db_change_log db_change_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.db_change_log
    ADD CONSTRAINT db_change_log_pkey PRIMARY KEY (id);


--
-- Name: departments departments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.departments
    ADD CONSTRAINT departments_pkey PRIMARY KEY (id);


--
-- Name: dept_direct_chats dept_direct_chats_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dept_direct_chats
    ADD CONSTRAINT dept_direct_chats_pkey PRIMARY KEY (id);


--
-- Name: divisions divisions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.divisions
    ADD CONSTRAINT divisions_pkey PRIMARY KEY (id);


--
-- Name: evolution_log evolution_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.evolution_log
    ADD CONSTRAINT evolution_log_pkey PRIMARY KEY (id);


--
-- Name: extracted_memories extracted_memories_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.extracted_memories
    ADD CONSTRAINT extracted_memories_pkey PRIMARY KEY (id);


--
-- Name: focus_sessions focus_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.focus_sessions
    ADD CONSTRAINT focus_sessions_pkey PRIMARY KEY (id);


--
-- Name: gmail_tokens gmail_tokens_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gmail_tokens
    ADD CONSTRAINT gmail_tokens_pkey PRIMARY KEY (email);


--
-- Name: goals goals_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.goals
    ADD CONSTRAINT goals_pkey PRIMARY KEY (id);


--
-- Name: habit_completions habit_completions_habit_id_completed_date_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.habit_completions
    ADD CONSTRAINT habit_completions_habit_id_completed_date_key UNIQUE (habit_id, completed_date);


--
-- Name: habit_completions habit_completions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.habit_completions
    ADD CONSTRAINT habit_completions_pkey PRIMARY KEY (id);


--
-- Name: habits habits_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.habits
    ADD CONSTRAINT habits_pkey PRIMARY KEY (id);


--
-- Name: interview_answers interview_answers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.interview_answers
    ADD CONSTRAINT interview_answers_pkey PRIMARY KEY (id);


--
-- Name: interview_prep_sessions interview_prep_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.interview_prep_sessions
    ADD CONSTRAINT interview_prep_sessions_pkey PRIMARY KEY (id);


--
-- Name: it_department_log it_department_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.it_department_log
    ADD CONSTRAINT it_department_log_pkey PRIMARY KEY (id);


--
-- Name: jazper_autonomous_actions jazper_autonomous_actions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.jazper_autonomous_actions
    ADD CONSTRAINT jazper_autonomous_actions_pkey PRIMARY KEY (id);


--
-- Name: jazper_autonomy jazper_autonomy_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.jazper_autonomy
    ADD CONSTRAINT jazper_autonomy_pkey PRIMARY KEY (category_id);


--
-- Name: job_applications job_applications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.job_applications
    ADD CONSTRAINT job_applications_pkey PRIMARY KEY (id);


--
-- Name: job_apply_profile job_apply_profile_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.job_apply_profile
    ADD CONSTRAINT job_apply_profile_pkey PRIMARY KEY (id);


--
-- Name: job_apply_runs job_apply_runs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.job_apply_runs
    ADD CONSTRAINT job_apply_runs_pkey PRIMARY KEY (id);


--
-- Name: job_cover_letters job_cover_letters_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.job_cover_letters
    ADD CONSTRAINT job_cover_letters_pkey PRIMARY KEY (id);


--
-- Name: job_radar_items job_radar_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.job_radar_items
    ADD CONSTRAINT job_radar_items_pkey PRIMARY KEY (id);


--
-- Name: job_runs job_runs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.job_runs
    ADD CONSTRAINT job_runs_pkey PRIMARY KEY (id);


--
-- Name: job_screening_answers job_screening_answers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.job_screening_answers
    ADD CONSTRAINT job_screening_answers_pkey PRIMARY KEY (id);


--
-- Name: key_results key_results_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.key_results
    ADD CONSTRAINT key_results_pkey PRIMARY KEY (id);


--
-- Name: knowledge_items knowledge_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.knowledge_items
    ADD CONSTRAINT knowledge_items_pkey PRIMARY KEY (id);


--
-- Name: mail_accounts mail_accounts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mail_accounts
    ADD CONSTRAINT mail_accounts_pkey PRIMARY KEY (id);


--
-- Name: mail_accounts mail_accounts_provider_address_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mail_accounts
    ADD CONSTRAINT mail_accounts_provider_address_key UNIQUE (provider, address);


--
-- Name: mail_attachments mail_attachments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mail_attachments
    ADD CONSTRAINT mail_attachments_pkey PRIMARY KEY (id);


--
-- Name: mail_messages mail_messages_account_id_provider_msg_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mail_messages
    ADD CONSTRAINT mail_messages_account_id_provider_msg_id_key UNIQUE (account_id, provider_msg_id);


--
-- Name: mail_messages mail_messages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mail_messages
    ADD CONSTRAINT mail_messages_pkey PRIMARY KEY (id);


--
-- Name: mail_rules mail_rules_kind_pattern_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mail_rules
    ADD CONSTRAINT mail_rules_kind_pattern_key UNIQUE (kind, pattern);


--
-- Name: mail_rules mail_rules_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mail_rules
    ADD CONSTRAINT mail_rules_pkey PRIMARY KEY (id);


--
-- Name: mail_sync_state mail_sync_state_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mail_sync_state
    ADD CONSTRAINT mail_sync_state_pkey PRIMARY KEY (account_id, folder);


--
-- Name: memories memories_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.memories
    ADD CONSTRAINT memories_pkey PRIMARY KEY (id);


--
-- Name: messages messages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.messages
    ADD CONSTRAINT messages_pkey PRIMARY KEY (id);


--
-- Name: model_cost_log model_cost_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.model_cost_log
    ADD CONSTRAINT model_cost_log_pkey PRIMARY KEY (id);


--
-- Name: mood_logs mood_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mood_logs
    ADD CONSTRAINT mood_logs_pkey PRIMARY KEY (id);


--
-- Name: notifications notifications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_pkey PRIMARY KEY (id);


--
-- Name: offer_evaluations offer_evaluations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.offer_evaluations
    ADD CONSTRAINT offer_evaluations_pkey PRIMARY KEY (id);


--
-- Name: phases_messages phases_messages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.phases_messages
    ADD CONSTRAINT phases_messages_pkey PRIMARY KEY (id);


--
-- Name: phases_profile phases_profile_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.phases_profile
    ADD CONSTRAINT phases_profile_pkey PRIMARY KEY (id);


--
-- Name: phases_profile phases_profile_singleton_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.phases_profile
    ADD CONSTRAINT phases_profile_singleton_key UNIQUE (singleton);


--
-- Name: phases_sessions phases_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.phases_sessions
    ADD CONSTRAINT phases_sessions_pkey PRIMARY KEY (id);


--
-- Name: phases_voice_config phases_voice_config_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.phases_voice_config
    ADD CONSTRAINT phases_voice_config_pkey PRIMARY KEY (personality_id);


--
-- Name: portfolio_items portfolio_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.portfolio_items
    ADD CONSTRAINT portfolio_items_pkey PRIMARY KEY (id);


--
-- Name: reading_list reading_list_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reading_list
    ADD CONSTRAINT reading_list_pkey PRIMARY KEY (id);


--
-- Name: reminders reminders_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reminders
    ADD CONSTRAINT reminders_pkey PRIMARY KEY (id);


--
-- Name: response_templates response_templates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.response_templates
    ADD CONSTRAINT response_templates_pkey PRIMARY KEY (id);


--
-- Name: roadmap_notes roadmap_notes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.roadmap_notes
    ADD CONSTRAINT roadmap_notes_pkey PRIMARY KEY (id);


--
-- Name: semantic_memories semantic_memories_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.semantic_memories
    ADD CONSTRAINT semantic_memories_pkey PRIMARY KEY (id);


--
-- Name: shared_memory shared_memory_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shared_memory
    ADD CONSTRAINT shared_memory_key_key UNIQUE (key);


--
-- Name: shared_memory shared_memory_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shared_memory
    ADD CONSTRAINT shared_memory_pkey PRIMARY KEY (id);


--
-- Name: social_scheduled_posts social_scheduled_posts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.social_scheduled_posts
    ADD CONSTRAINT social_scheduled_posts_pkey PRIMARY KEY (id);


--
-- Name: sprint_tasks sprint_tasks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sprint_tasks
    ADD CONSTRAINT sprint_tasks_pkey PRIMARY KEY (id);


--
-- Name: sprints sprints_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sprints
    ADD CONSTRAINT sprints_pkey PRIMARY KEY (id);


--
-- Name: standup_history standup_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.standup_history
    ADD CONSTRAINT standup_history_pkey PRIMARY KEY (id);


--
-- Name: task_priority_cache task_priority_cache_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_priority_cache
    ADD CONSTRAINT task_priority_cache_pkey PRIMARY KEY (task_id);


--
-- Name: tasks tasks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tasks
    ADD CONSTRAINT tasks_pkey PRIMARY KEY (id);


--
-- Name: teams teams_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.teams
    ADD CONSTRAINT teams_pkey PRIMARY KEY (id);


--
-- Name: telegram_config telegram_config_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.telegram_config
    ADD CONSTRAINT telegram_config_pkey PRIMARY KEY (id);


--
-- Name: user_profile user_profile_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_profile
    ADD CONSTRAINT user_profile_pkey PRIMARY KEY (id);


--
-- Name: users users_email_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_email_key UNIQUE (email);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: voice_journal voice_journal_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.voice_journal
    ADD CONSTRAINT voice_journal_pkey PRIMARY KEY (id);


--
-- Name: webhook_registry webhook_registry_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.webhook_registry
    ADD CONSTRAINT webhook_registry_pkey PRIMARY KEY (id);


--
-- Name: weekly_digests weekly_digests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.weekly_digests
    ADD CONSTRAINT weekly_digests_pkey PRIMARY KEY (id);


--
-- Name: ws_notifications ws_notifications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ws_notifications
    ADD CONSTRAINT ws_notifications_pkey PRIMARY KEY (id);


--
-- Name: ws_projects ws_projects_path_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ws_projects
    ADD CONSTRAINT ws_projects_path_key UNIQUE (path);


--
-- Name: ws_projects ws_projects_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ws_projects
    ADD CONSTRAINT ws_projects_pkey PRIMARY KEY (id);


--
-- Name: ws_task_events ws_task_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ws_task_events
    ADD CONSTRAINT ws_task_events_pkey PRIMARY KEY (id);


--
-- Name: ws_tasks ws_tasks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ws_tasks
    ADD CONSTRAINT ws_tasks_pkey PRIMARY KEY (id);


--
-- Name: ws_tasks ws_tasks_project_id_seq_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ws_tasks
    ADD CONSTRAINT ws_tasks_project_id_seq_key UNIQUE (project_id, seq);


--
-- Name: idx_agent_actions_agent; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_agent_actions_agent ON public.agent_actions USING btree (agent_id, created_at DESC);


--
-- Name: idx_agent_actions_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_agent_actions_created ON public.agent_actions USING btree (created_at DESC);


--
-- Name: idx_agent_comms_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_agent_comms_created ON public.agent_communications USING btree (created_at DESC);


--
-- Name: idx_agent_comms_from; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_agent_comms_from ON public.agent_communications USING btree (from_agent, created_at DESC);


--
-- Name: idx_agent_comms_to; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_agent_comms_to ON public.agent_communications USING btree (to_agent, created_at DESC);


--
-- Name: idx_agent_direct_chats_codename; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_agent_direct_chats_codename ON public.agent_direct_chats USING btree (agent_codename, created_at DESC);


--
-- Name: idx_agent_errors_agent; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_agent_errors_agent ON public.agent_errors USING btree (agent);


--
-- Name: idx_agent_errors_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_agent_errors_created ON public.agent_errors USING btree (created_at DESC);


--
-- Name: idx_agent_errors_resolved; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_agent_errors_resolved ON public.agent_errors USING btree (resolved);


--
-- Name: idx_agent_goals_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_agent_goals_active ON public.agent_goals USING btree (status, created_at DESC);


--
-- Name: idx_agent_goals_codename; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_agent_goals_codename ON public.agent_goals USING btree (agent_codename, status);


--
-- Name: idx_agent_memory_codename; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_agent_memory_codename ON public.agent_memory USING btree (agent_codename, updated_at DESC);


--
-- Name: idx_approvals_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_approvals_created ON public.approval_requests USING btree (created_at DESC);


--
-- Name: idx_approvals_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_approvals_status ON public.approval_requests USING btree (status);


--
-- Name: idx_biz_clients_source_lead; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_biz_clients_source_lead ON public.biz_clients USING btree (source_lead_id);


--
-- Name: idx_biz_clients_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_biz_clients_status ON public.biz_clients USING btree (status);


--
-- Name: idx_biz_expenses_project; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_biz_expenses_project ON public.biz_expenses USING btree (project_id);


--
-- Name: idx_biz_invoice_items_invoice; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_biz_invoice_items_invoice ON public.biz_invoice_line_items USING btree (invoice_id);


--
-- Name: idx_biz_invoices_client; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_biz_invoices_client ON public.biz_invoices USING btree (client_id);


--
-- Name: idx_biz_invoices_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_biz_invoices_status ON public.biz_invoices USING btree (status);


--
-- Name: idx_biz_projects_client; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_biz_projects_client ON public.biz_projects USING btree (client_id);


--
-- Name: idx_biz_projects_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_biz_projects_status ON public.biz_projects USING btree (status);


--
-- Name: idx_biz_team_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_biz_team_status ON public.biz_team_members USING btree (status);


--
-- Name: idx_biz_team_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_biz_team_type ON public.biz_team_members USING btree (member_type);


--
-- Name: idx_chat_messages_session; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_chat_messages_session ON public.chat_messages USING btree (session_id);


--
-- Name: idx_code_chunks_emb; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_code_chunks_emb ON public.code_chunks USING ivfflat (embedding public.vector_cosine_ops) WITH (lists='50');


--
-- Name: idx_code_chunks_file; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_code_chunks_file ON public.code_chunks USING btree (workspace_root, file_path);


--
-- Name: idx_code_chunks_workspace; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_code_chunks_workspace ON public.code_chunks USING btree (workspace_root);


--
-- Name: idx_db_change_log_agent; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_db_change_log_agent ON public.db_change_log USING btree (agent_name);


--
-- Name: idx_db_change_log_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_db_change_log_created ON public.db_change_log USING btree (created_at DESC);


--
-- Name: idx_dept_direct_chats_dept; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_dept_direct_chats_dept ON public.dept_direct_chats USING btree (dept_id, created_at DESC);


--
-- Name: idx_evolution_log_action; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_evolution_log_action ON public.evolution_log USING btree (action_type, created_at DESC);


--
-- Name: idx_evolution_log_agent; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_evolution_log_agent ON public.evolution_log USING btree (agent_codename, created_at DESC);


--
-- Name: idx_evolution_log_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_evolution_log_created ON public.evolution_log USING btree (created_at DESC);


--
-- Name: idx_extracted_emb; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_extracted_emb ON public.extracted_memories USING ivfflat (embedding public.vector_cosine_ops) WITH (lists='50');


--
-- Name: idx_focus_started; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_focus_started ON public.focus_sessions USING btree (started_at DESC);


--
-- Name: idx_it_log_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_it_log_created ON public.it_department_log USING btree (created_at DESC);


--
-- Name: idx_it_log_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_it_log_status ON public.it_department_log USING btree (status);


--
-- Name: idx_it_log_ticket; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_it_log_ticket ON public.it_department_log USING btree (ticket_id);


--
-- Name: idx_job_apps_applied; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_job_apps_applied ON public.job_applications USING btree (applied_at DESC);


--
-- Name: idx_job_apps_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_job_apps_status ON public.job_applications USING btree (status);


--
-- Name: idx_job_runs_cron_job; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_job_runs_cron_job ON public.job_runs USING btree (cron_job_id);


--
-- Name: idx_job_runs_started; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_job_runs_started ON public.job_runs USING btree (started_at DESC);


--
-- Name: idx_mail_att_msg; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_mail_att_msg ON public.mail_attachments USING btree (message_id);


--
-- Name: idx_mail_msg_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_mail_msg_date ON public.mail_messages USING btree (date DESC);


--
-- Name: idx_mail_msg_from_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_mail_msg_from_trgm ON public.mail_messages USING gin (from_addr public.gin_trgm_ops);


--
-- Name: idx_mail_msg_imp; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_mail_msg_imp ON public.mail_messages USING btree (importance DESC, date DESC);


--
-- Name: idx_mail_msg_search; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_mail_msg_search ON public.mail_messages USING gin (search);


--
-- Name: idx_mail_msg_subject_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_mail_msg_subject_trgm ON public.mail_messages USING gin (subject public.gin_trgm_ops);


--
-- Name: idx_model_cost_log_agent; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_model_cost_log_agent ON public.model_cost_log USING btree (agent, created_at DESC);


--
-- Name: idx_model_cost_log_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_model_cost_log_created ON public.model_cost_log USING btree (created_at DESC);


--
-- Name: idx_model_cost_log_model; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_model_cost_log_model ON public.model_cost_log USING btree (model, created_at DESC);


--
-- Name: idx_mood_logged; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_mood_logged ON public.mood_logs USING btree (logged_at DESC);


--
-- Name: idx_notifications_read; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notifications_read ON public.notifications USING btree (read);


--
-- Name: idx_phases_messages_session; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_phases_messages_session ON public.phases_messages USING btree (session_id);


--
-- Name: idx_plans_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_plans_created ON public.agent_plans USING btree (created_at DESC);


--
-- Name: idx_plans_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_plans_status ON public.agent_plans USING btree (status);


--
-- Name: idx_roadmap_notes_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_roadmap_notes_created ON public.roadmap_notes USING btree (created_at DESC);


--
-- Name: idx_semantic_emb; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_semantic_emb ON public.semantic_memories USING ivfflat (embedding public.vector_cosine_ops) WITH (lists='50');


--
-- Name: idx_shared_memory_agent; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_shared_memory_agent ON public.shared_memory USING btree (writing_agent);


--
-- Name: idx_shared_memory_key; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_shared_memory_key ON public.shared_memory USING btree (key);


--
-- Name: idx_shared_memory_tags; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_shared_memory_tags ON public.shared_memory USING gin (tags);


--
-- Name: idx_sprint_tasks_sprint; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sprint_tasks_sprint ON public.sprint_tasks USING btree (sprint_id);


--
-- Name: idx_tasks_due; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tasks_due ON public.tasks USING btree (due_at);


--
-- Name: idx_tasks_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tasks_status ON public.tasks USING btree (status);


--
-- Name: idx_webhooks_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_webhooks_active ON public.webhook_registry USING btree (active, created_at DESC);


--
-- Name: idx_ws_events_task; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ws_events_task ON public.ws_task_events USING btree (task_id, created_at);


--
-- Name: idx_ws_notifications_project; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ws_notifications_project ON public.ws_notifications USING btree (project_id, read, created_at);


--
-- Name: idx_ws_notifications_task; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ws_notifications_task ON public.ws_notifications USING btree (task_id);


--
-- Name: idx_ws_tasks_github_issue; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ws_tasks_github_issue ON public.ws_tasks USING btree (project_id, github_issue_number);


--
-- Name: idx_ws_tasks_parent; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ws_tasks_parent ON public.ws_tasks USING btree (parent_id);


--
-- Name: idx_ws_tasks_project; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ws_tasks_project ON public.ws_tasks USING btree (project_id, status);


--
-- Name: memories_embedding_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX memories_embedding_idx ON public.memories USING ivfflat (embedding public.vector_cosine_ops);


--
-- Name: agent_registry agent_registry_reports_to_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_registry
    ADD CONSTRAINT agent_registry_reports_to_fkey FOREIGN KEY (reports_to) REFERENCES public.agent_registry(agent_id);


--
-- Name: automation_history automation_history_rule_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.automation_history
    ADD CONSTRAINT automation_history_rule_id_fkey FOREIGN KEY (rule_id) REFERENCES public.automation_rules(id) ON DELETE CASCADE;


--
-- Name: biz_expenses biz_expenses_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.biz_expenses
    ADD CONSTRAINT biz_expenses_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.biz_projects(id) ON DELETE SET NULL;


--
-- Name: biz_invoice_line_items biz_invoice_line_items_invoice_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.biz_invoice_line_items
    ADD CONSTRAINT biz_invoice_line_items_invoice_id_fkey FOREIGN KEY (invoice_id) REFERENCES public.biz_invoices(id) ON DELETE CASCADE;


--
-- Name: biz_invoices biz_invoices_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.biz_invoices
    ADD CONSTRAINT biz_invoices_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.biz_clients(id) ON DELETE CASCADE;


--
-- Name: biz_invoices biz_invoices_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.biz_invoices
    ADD CONSTRAINT biz_invoices_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.biz_projects(id) ON DELETE SET NULL;


--
-- Name: biz_project_assignments biz_project_assignments_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.biz_project_assignments
    ADD CONSTRAINT biz_project_assignments_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.biz_projects(id) ON DELETE CASCADE;


--
-- Name: biz_project_assignments biz_project_assignments_team_member_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.biz_project_assignments
    ADD CONSTRAINT biz_project_assignments_team_member_id_fkey FOREIGN KEY (team_member_id) REFERENCES public.biz_team_members(id) ON DELETE CASCADE;


--
-- Name: biz_projects biz_projects_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.biz_projects
    ADD CONSTRAINT biz_projects_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.biz_clients(id) ON DELETE CASCADE;


--
-- Name: chat_messages chat_messages_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_messages
    ADD CONSTRAINT chat_messages_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.chat_sessions(id) ON DELETE CASCADE;


--
-- Name: conversations conversations_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversations
    ADD CONSTRAINT conversations_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: departments departments_head_agent_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.departments
    ADD CONSTRAINT departments_head_agent_fkey FOREIGN KEY (head_agent) REFERENCES public.agent_registry(agent_id);


--
-- Name: habit_completions habit_completions_habit_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.habit_completions
    ADD CONSTRAINT habit_completions_habit_id_fkey FOREIGN KEY (habit_id) REFERENCES public.habits(id) ON DELETE CASCADE;


--
-- Name: interview_answers interview_answers_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.interview_answers
    ADD CONSTRAINT interview_answers_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.interview_prep_sessions(id) ON DELETE CASCADE;


--
-- Name: job_runs job_runs_cron_job_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.job_runs
    ADD CONSTRAINT job_runs_cron_job_id_fkey FOREIGN KEY (cron_job_id) REFERENCES public.cron_jobs(id) ON DELETE CASCADE;


--
-- Name: key_results key_results_goal_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.key_results
    ADD CONSTRAINT key_results_goal_id_fkey FOREIGN KEY (goal_id) REFERENCES public.goals(id) ON DELETE CASCADE;


--
-- Name: mail_attachments mail_attachments_message_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mail_attachments
    ADD CONSTRAINT mail_attachments_message_id_fkey FOREIGN KEY (message_id) REFERENCES public.mail_messages(id) ON DELETE CASCADE;


--
-- Name: mail_messages mail_messages_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mail_messages
    ADD CONSTRAINT mail_messages_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.mail_accounts(id) ON DELETE CASCADE;


--
-- Name: mail_sync_state mail_sync_state_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mail_sync_state
    ADD CONSTRAINT mail_sync_state_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.mail_accounts(id) ON DELETE CASCADE;


--
-- Name: messages messages_conversation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.messages
    ADD CONSTRAINT messages_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES public.conversations(id) ON DELETE CASCADE;


--
-- Name: notifications notifications_job_run_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_job_run_id_fkey FOREIGN KEY (job_run_id) REFERENCES public.job_runs(id) ON DELETE SET NULL;


--
-- Name: phases_messages phases_messages_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.phases_messages
    ADD CONSTRAINT phases_messages_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.phases_sessions(id) ON DELETE CASCADE;


--
-- Name: sprint_tasks sprint_tasks_sprint_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sprint_tasks
    ADD CONSTRAINT sprint_tasks_sprint_id_fkey FOREIGN KEY (sprint_id) REFERENCES public.sprints(id) ON DELETE CASCADE;


--
-- Name: teams teams_department_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.teams
    ADD CONSTRAINT teams_department_id_fkey FOREIGN KEY (department_id) REFERENCES public.departments(id);


--
-- Name: teams teams_division_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.teams
    ADD CONSTRAINT teams_division_id_fkey FOREIGN KEY (division_id) REFERENCES public.divisions(id);


--
-- Name: ws_notifications ws_notifications_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ws_notifications
    ADD CONSTRAINT ws_notifications_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.ws_projects(id) ON DELETE CASCADE;


--
-- Name: ws_notifications ws_notifications_task_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ws_notifications
    ADD CONSTRAINT ws_notifications_task_id_fkey FOREIGN KEY (task_id) REFERENCES public.ws_tasks(id) ON DELETE CASCADE;


--
-- Name: ws_task_events ws_task_events_task_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ws_task_events
    ADD CONSTRAINT ws_task_events_task_id_fkey FOREIGN KEY (task_id) REFERENCES public.ws_tasks(id) ON DELETE CASCADE;


--
-- Name: ws_tasks ws_tasks_parent_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ws_tasks
    ADD CONSTRAINT ws_tasks_parent_id_fkey FOREIGN KEY (parent_id) REFERENCES public.ws_tasks(id) ON DELETE CASCADE;


--
-- Name: ws_tasks ws_tasks_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ws_tasks
    ADD CONSTRAINT ws_tasks_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.ws_projects(id) ON DELETE CASCADE;


--
-- PostgreSQL database dump complete
--


