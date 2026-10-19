import asyncio

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.base import BaseHTTPMiddleware
from contextlib import asynccontextmanager
import structlog
import structlog.dev
import structlog.stdlib
import structlog.processors
from collections import deque
import datetime

from api.routes import chat, memory, health, tasks, ws, models, voice, history, logs as logs_route, dashboard as dashboard_route, notifications as notifications_route
from api.routes import jobs as jobs_route
from api.routes import google as google_route
from api.routes import apply as apply_route
from api.routes import profile as profile_route
from api.routes import agents as agents_route
from api.routes import db_changes as db_changes_route
from api.routes import company_dashboard as company_route
from api.routes import phases as phases_route
from api.routes import roadmap as roadmap_route
from api.routes import approvals as approvals_route
from api.routes import plans as plans_route
from api.routes import workflows as workflows_route
from api.routes import it_department as it_route
from api.routes import voice_profile as voice_profile_route
from api.routes import storage as storage_route
from api.routes import ide as ide_route
from api.routes import control_tower as control_tower_route
from api.routes import voyager as voyager_route
from api.routes import service_registry as service_registry_route
from api.routes import timeline as timeline_route
from api.routes import stream as stream_route
from api.routes import agent_chat as agent_chat_route
from api.routes.agent_chat import dept_router as dept_chat_router
from api.routes import evolution as evolution_route
from api.routes import calendar as calendar_route
from api.routes import plugins as plugins_route
from api.routes import shared_memory as shared_memory_route
from api.routes import webhooks as webhooks_route
from api.routes import model_costs as model_costs_route
from api.routes import telegram as telegram_route
from api.routes import briefings as briefings_route
from api.routes import alert_config as alert_config_route
from api.routes import resume as resume_route
from api.routes import suggestions as suggestions_route
from api.routes import automation as automation_route
from api.routes import knowledge as knowledge_route
from api.routes import cover_letter as cover_letter_route
from api.routes import contacts as contacts_route
from api.routes import planner as planner_route
from api.routes import habits as habits_route
from api.routes import search as search_route
from api.routes import compose as compose_route
from api.routes import stats as stats_route
from api.routes import onboarding as onboarding_route
from api.routes import activity as activity_route
from api.routes import export_data as export_data_route
from api.routes import hermes_drafts as hermes_drafts_route
from api.routes import job_radar as job_radar_route
from api.routes import voice_journal as voice_journal_route
from api.routes import templates as templates_route
from api.routes import email_analytics as email_analytics_route
from api.routes import reminders as reminders_route
from api.routes.interview_prep import router as interview_prep_route
from api.routes.focus import router as focus_route
from api.routes.goals import router as goals_router
from api.routes.digest import router as digest_router
from api.routes.triage import router as triage_router
from api.routes.mood import router as mood_router
from api.routes.task_priority import router as task_priority_router
from api.routes.followup import router as followup_router
from api.routes.reading_list import router as reading_list_router
from api.routes.sprints import router as sprints_router
from api.routes.offer_eval import router as offer_eval_router
from api.routes.portfolio import router as portfolio_router
from api.routes.salary_coach import router as salary_coach_router
from api.routes.standup import router as standup_router
from api.routes import hive as hive_route
from api.routes import org as org_route
from api.business.routes import clients as biz_clients_route, chat as biz_chat_route, projects as biz_projects_route, team as biz_team_route, finance as biz_finance_route
from core.config import settings

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



async def _auto_repair_loop():
    """Background task: watch the log buffer for error-level events and trigger Darwin."""
    import queue as _q
    from core.services.error_store import error_store
    from agents.roster.darwin_agent import DarwinAgent

    q: _q.Queue = _q.Queue(maxsize=500)
    log_subscribers.append(q)
    log.info("IT auto-repair loop started")

    try:
        while True:
            await asyncio.sleep(0.5)
            while not q.empty():
                try:
                    entry = q.get_nowait()
                except _q.Empty:
                    break
                if entry.get("level") not in ("error", "critical"):
                    continue
                msg = entry.get("message", "")
                extra = entry.get("extra", {})
                err_str = extra.get("error", msg)
                tb_str  = extra.get("traceback", "")

                # Skip noisy non-actionable errors
                if any(skip in msg.lower() for skip in (
                    "rate-limit", "connection refused", "could not connect",
                    "agent error recorded",  # avoid re-recording our own records
                )):
                    continue

                recorded = await error_store.record(
                    agent=extra.get("agent", "System"),
                    error=err_str[:500],
                    traceback_str=tb_str[:3000],
                    context={"log_entry": entry},
                )
                log.info("IT: dispatching Darwin for auto-repair", error_id=recorded.error_id)
                asyncio.create_task(DarwinAgent.handle_repair(recorded.error_id))
    finally:
        try:
            log_subscribers.remove(q)
        except ValueError:
            pass


@asynccontextmanager
async def lifespan(app: FastAPI):
    log.info("Sir Jazper OS starting", model=settings.AI_MODEL, env=settings.ENV)
    from memory.db.init import ensure_tables
    ensure_tables()

    from api.business.db import ensure_business_tables
    ensure_business_tables()

    from core.services.storage import storage as _storage
    _storage.ensure_bucket()

    from core.scheduler.scheduler import start_scheduler, stop_scheduler
    from core.services.linkedin_service import seed_default_screening_answers
    try:
        seed_default_screening_answers()
    except Exception:
        pass
    start_scheduler()

    # Hive layer: seed agent workspaces + fleet log
    try:
        from core.services.hive_service import hive as _hive
        _hive.init()
        log.info("Hive layer initialized", root=str(_hive.root()))
    except Exception as hive_exc:
        log.warning("Hive init failed (non-fatal)", error=str(hive_exc))

    # Start IT Department auto-repair background loop
    asyncio.create_task(_auto_repair_loop(), name="it-auto-repair")

    from core.telemetry import setup_export
    setup_export()  # OTLP export only when OTEL_EXPORTER_OTLP_ENDPOINT is set

    # Plan V2 F1: load hot-pluggable bots and open the durable checkpointer
    try:
        from agents.registry import registry as _bot_registry
        from agents.org import ensure_org
        await ensure_org()  # seeds executives + spec crews once; never overwrites edits
        from core.durable import get_checkpointer
        await get_checkpointer()
    except Exception as exc:
        log.warning("bot registry / checkpointer init failed (non-fatal)", error=str(exc)[:160])

    # Phase 7D: start filesystem watcher (daemon thread, auto-triggers npm/pip install)
    from core.system.file_watcher import start as fw_start
    try:
        fw_start(asyncio.get_event_loop())
    except Exception as fw_exc:
        log.warning("FileWatcher: failed to start (non-fatal)", error=str(fw_exc))

    yield

    stop_scheduler()
    log.info("Sir Jazper OS shutting down")


app = FastAPI(title="CREATE ORIGINS OS", version="1.0.0", lifespan=lifespan)


class NoCacheMunderMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        response = await call_next(request)
        if request.url.path.startswith("/munder"):
            response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate"
            response.headers["Pragma"] = "no-cache"
        return response


app.add_middleware(NoCacheMunderMiddleware)
app.add_middleware(
    CORSMiddleware,
    allow_origins=sorted({settings.FRONTEND_URL, "http://localhost:5173", "http://127.0.0.1:5173", "http://localhost:3001", "http://127.0.0.1:3001"}),
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
app.include_router(agents_route.router,        prefix="/api/agents",         tags=["agents"])
app.include_router(org_route.router,           prefix="/api/org",            tags=["org"])
app.include_router(phases_route.router,        prefix="/api/phases",         tags=["phases"])
app.include_router(roadmap_route.router,       prefix="/api/roadmap",        tags=["roadmap"])
app.include_router(approvals_route.router,     prefix="/api/approvals",      tags=["approvals"])
app.include_router(plans_route.router,         prefix="/api/plans",          tags=["plans"])
app.include_router(workflows_route.router,     prefix="/api/workflows",      tags=["workflows"])
app.include_router(it_route.router,            prefix="/api/it",             tags=["it-department"])
app.include_router(voice_profile_route.router, prefix="/api/voice-profile",  tags=["voice-profile"])
app.include_router(storage_route.router,       prefix="/api/storage",        tags=["storage"])
app.include_router(ide_route.router,           prefix="/api/ide",            tags=["ide"])
app.include_router(control_tower_route.router, prefix="/api/control-tower",  tags=["control-tower"])
app.include_router(voyager_route.router,          prefix="/api/voyager",          tags=["voyager"])
app.include_router(service_registry_route.router, prefix="/api/services",         tags=["service-registry"])
app.include_router(timeline_route.router,         prefix="/api/timeline",         tags=["timeline"])
app.include_router(stream_route.router,           prefix="/api/stream",           tags=["stream"])
app.include_router(agent_chat_route.router,       prefix="/api/direct/agent",     tags=["agent-direct-chat"])
app.include_router(dept_chat_router,              prefix="/api/direct/dept",      tags=["dept-direct-chat"])
app.include_router(db_changes_route.router)
app.include_router(company_route.router)
app.include_router(evolution_route.router)
app.include_router(calendar_route.router,       prefix="/api/calendar",       tags=["calendar"])
app.include_router(plugins_route.router,        prefix="/api/plugins",        tags=["plugins"])
app.include_router(shared_memory_route.router,  prefix="/api/shared-memory",  tags=["shared-memory"])
app.include_router(webhooks_route.router,       prefix="/api/webhooks",       tags=["webhooks"])
app.include_router(model_costs_route.router,    prefix="/api/model-costs",    tags=["model-costs"])
app.include_router(telegram_route.router,       prefix="/api/telegram",       tags=["telegram"])
app.include_router(briefings_route.router,      prefix="/api/briefings",      tags=["briefings"])
app.include_router(alert_config_route.router,   prefix="/api/alert-config",   tags=["alert-config"])
app.include_router(resume_route.router,         prefix="/api/resume",         tags=["resume"])
app.include_router(suggestions_route.router,    prefix="/api/suggestions",    tags=["suggestions"])
app.include_router(automation_route.router,     prefix="/api/automation",     tags=["automation"])
app.include_router(knowledge_route.router,      prefix="/api/knowledge",      tags=["knowledge"])
app.include_router(cover_letter_route.router,   prefix="/api/cover-letter",   tags=["cover-letter"])
app.include_router(contacts_route.router,       prefix="/api/contacts",       tags=["contacts"])
app.include_router(planner_route.router,        prefix="/api/planner",        tags=["planner"])
app.include_router(habits_route.router,         prefix="/api/habits",         tags=["habits"])
app.include_router(search_route.router,         prefix="/api/search",         tags=["search"])
app.include_router(compose_route.router,        prefix="/api/compose",        tags=["compose"])
app.include_router(stats_route.router,          prefix="/api/stats",          tags=["stats"])
app.include_router(onboarding_route.router,     prefix="/api/onboarding",     tags=["onboarding"])
app.include_router(activity_route.router,       prefix="/api/activity",       tags=["activity"])
app.include_router(export_data_route.router,    prefix="/api/export",         tags=["export"])
app.include_router(hermes_drafts_route.router,  prefix="/api/hermes",          tags=["hermes"])
app.include_router(job_radar_route.router,      prefix="/api/jobs/radar",      tags=["job_radar"])
app.include_router(voice_journal_route.router,   prefix="/api/voice-journal",    tags=["voice_journal"])
app.include_router(templates_route.router,        prefix="/api/templates",         tags=["templates"])
app.include_router(email_analytics_route.router,  prefix="/api/email-analytics",   tags=["email_analytics"])
app.include_router(reminders_route.router,        prefix="/api/reminders",         tags=["reminders"])
app.include_router(interview_prep_route,          prefix="/api/interview-prep",    tags=["interview-prep"])
app.include_router(focus_route,                   prefix="/api/focus",             tags=["focus"])
app.include_router(goals_router,                  prefix="/api/goals",             tags=["goals"])
app.include_router(digest_router,                 prefix="/api/digest",            tags=["digest"])
app.include_router(triage_router,                 prefix="/api/triage",            tags=["triage"])
app.include_router(mood_router,                   prefix="/api/mood",              tags=["mood"])
app.include_router(task_priority_router,          prefix="/api/task-priority",     tags=["task-priority"])
app.include_router(followup_router,               prefix="/api/followup",          tags=["followup"])
app.include_router(reading_list_router,           prefix="/api/reading-list",      tags=["reading-list"])
app.include_router(sprints_router,                prefix="/api/sprints",           tags=["sprints"])
app.include_router(offer_eval_router,             prefix="/api/offer-eval",        tags=["offer-eval"])
app.include_router(portfolio_router,              prefix="/api/portfolio",         tags=["portfolio"])
app.include_router(salary_coach_router,           prefix="/api/salary-coach",      tags=["salary-coach"])
app.include_router(standup_router,                prefix="/api/standup",           tags=["standup"])
app.include_router(hive_route.router,             prefix="/api/hive",              tags=["hive"])

# ── Business Platform (COOS) — separate track ──
app.include_router(biz_clients_route.router, prefix="/api/business/clients", tags=["business-clients"])
app.include_router(biz_projects_route.router, prefix="/api/business/projects", tags=["business-projects"])
app.include_router(biz_team_route.router,    prefix="/api/business/team",    tags=["business-team"])
app.include_router(biz_chat_route.router,    prefix="/api/business/chat",    tags=["business-chat"])
app.include_router(biz_finance_route.router, prefix="/api/business/finance", tags=["business-finance"])

from api.routes import directory as directory_route
app.include_router(directory_route.router, prefix="/api/directory", tags=["directory"])
from api.routes import llm as llm_route
app.include_router(llm_route.router, prefix="/api/llm", tags=["llm"])
from api.routes import rpc as rpc_route
app.include_router(rpc_route.router, prefix="/ws", tags=["websocket"])
from api.routes import bots as bots_route
app.include_router(bots_route.router, prefix="/api/bots", tags=["bots"])
from api.routes import directive as directive_route
app.include_router(directive_route.router, prefix="/api/directive", tags=["directive"])
from api.routes import hitl as hitl_route
app.include_router(hitl_route.router, prefix="/api/hitl", tags=["hitl"])
from api.routes import chat2 as chat2_route
app.include_router(chat2_route.router, prefix="/api/chat2", tags=["chat2"])
from api.routes import edit as edit_route
app.include_router(edit_route.router, prefix="/api/edit", tags=["edit"])
from api.routes import company as company_route
app.include_router(company_route.router, prefix="/api/company", tags=["company"])
from api.routes import finops as finops_route
app.include_router(finops_route.router, prefix="/api/finops", tags=["finops"])
from api.routes import mcp_hub as mcp_hub_route
app.include_router(mcp_hub_route.router, prefix="/api/mcp-hub", tags=["mcp-hub"])
from api.routes import system as system_route
app.include_router(system_route.router, prefix="/api/system", tags=["system"])
from api.versioning import add_v1_aliases
add_v1_aliases(app)

# ── Munder Difflin web (COOS copy) ───────────────────────────────────────────
# Serves the Munder renderer bundle at /munder/index.html in "coos" mode, where
# it connects back to this same backend (agents/live + /ws + /api/hive/*).
from fastapi.staticfiles import StaticFiles
from pathlib import Path

_MUNDER_DIST = Path(__file__).resolve().parent.parent / "munder-web" / "dist"
if _MUNDER_DIST.exists():
    app.mount("/munder", StaticFiles(directory=str(_MUNDER_DIST), html=True), name="munder")
else:
    log.warning("munder-web dist not found", path=str(_MUNDER_DIST))

