"""Connection engine used by the Connector bot, the Connections panel and Jasper.

For each connector it answers: what does it need, is it connected, does a harmless read call work? Secrets come from the OS vault; if a needed
secret exists only in backend/python/.env it is copied into the vault automatically (the founder said: "if it's there, connect by itself").
Missing secrets produce a credential request that the chat renders as a secure card (value goes straight to the vault, never through chat
history or logs). Google uses the existing OAuth flow (system browser, loopback redirect on the backend). Tiers: reads 1, writes 2, admin 3.
"""
import os
import time
from pathlib import Path

from core import vault
from hub import presets as hub_presets
from hub.hub import ToolError, hub

ENV_FILE = Path(__file__).resolve().parents[1] / ".env"
API = os.getenv("JASPER_API_URL", "http://localhost:8000")

# extra connectors on top of hub/presets.py; "untested" ones are declared honestly and not yet verified against the real service
EXTRA = {
    "slack": {"name": "Slack (official MCP server)", "command": [hub_presets.NPX, "-y", "@modelcontextprotocol/server-slack"],
              "env_secrets": {"SLACK_BOT_TOKEN": "SLACK_BOT_TOKEN", "SLACK_TEAM_ID": "SLACK_TEAM_ID"}, "needs": "Slack bot token (xoxb-...) and team id.",
              "tool_tiers": {"slack_post_message": "mcp.write", "slack_reply_to_thread": "mcp.write", "slack_add_reaction": "mcp.write"}, "untested": True},
    "brave-search": {"name": "Brave Search (Brave's maintained MCP server)", "command": [hub_presets.NPX, "-y", "@brave/brave-search-mcp-server", "--transport", "stdio"],
                     "env_secrets": {"BRAVE_API_KEY": "BRAVE_API_KEY"}, "needs": "Brave Search API key (free tier available).", "tool_tiers": {}, "untested": True},
    "playwright": {"name": "Playwright browser (official MCP server)", "command": [hub_presets.NPX, "-y", "@playwright/mcp@latest", "--headless"],
                   "env_secrets": {}, "needs": "", "tool_tiers": {"browser_click": "mcp.write", "browser_type": "mcp.write", "browser_navigate": "mcp.write"}},  # verified live 2026-10-21: 25 tools, browser_tabs read ok
    "notion": {"name": "Notion (official MCP server)", "command": [hub_presets.NPX, "-y", "@notionhq/notion-mcp-server"],
               "env_secrets": {"NOTION_TOKEN": "NOTION_TOKEN"}, "needs": "Notion internal integration token.", "tool_tiers": {}, "untested": True},
}
# --- added 2026-11-09: package names, versions and key requirements verified against the npm registry and each package README.
# Every one of these is "untested": the package exists and the launch arguments/keys follow its README, but none has been connected yet.
# Use Connections -> Test; the three that need no account (context7, sequential-thinking, chrome-devtools) are the easiest first check.
EXTRA.update({
    "context7": {"name": "Context7 - up-to-date library docs for coding bots", "command": [hub_presets.NPX, "-y", "@upstash/context7-mcp"], "env_secrets": {}, "needs": "", "tool_tiers": {}, "untested": False},  # launched and listed 2 tools on 2026-11-13
    "sequential-thinking": {"name": "Sequential Thinking - structured step-by-step reasoning", "command": [hub_presets.NPX, "-y", "@modelcontextprotocol/server-sequential-thinking"],
                            "env_secrets": {}, "needs": "", "tool_tiers": {}, "untested": False},  # launched and listed 1 tool on 2026-11-13
    "chrome-devtools": {"name": "Chrome DevTools - inspect, debug and measure web pages", "command": [hub_presets.NPX, "-y", "chrome-devtools-mcp@latest", "--headless", "--isolated"],
                        "env_secrets": {}, "needs": "Chrome installed on this PC.", "tool_tiers": {}, "untested": True},
    "firecrawl": {"name": "Firecrawl - scrape and crawl websites into clean text", "command": [hub_presets.NPX, "-y", "firecrawl-mcp"],
                  "env_secrets": {"FIRECRAWL_API_KEY": "FIRECRAWL_API_KEY"}, "needs": "Firecrawl API key (free tier available).", "tool_tiers": {}, "untested": True},
    "tavily": {"name": "Tavily - web search built for AI agents", "command": [hub_presets.NPX, "-y", "tavily-mcp@latest"],
               "env_secrets": {"TAVILY_API_KEY": "TAVILY_API_KEY"}, "needs": "Tavily API key (free tier available).", "tool_tiers": {}, "untested": True},
    "apify": {"name": "Apify - thousands of ready scrapers (LinkedIn, maps, social, e-commerce)", "command": [hub_presets.NPX, "-y", "@apify/actors-mcp-server"],
              "env_secrets": {"APIFY_TOKEN": "APIFY_TOKEN"}, "needs": "Apify API token (free monthly credits).", "tool_tiers": {}, "untested": True},
    "sentry": {"name": "Sentry - production errors and performance", "command": [hub_presets.NPX, "-y", "@sentry/mcp-server@latest"],
               "env_secrets": {"SENTRY_AUTH_TOKEN": "SENTRY_AUTH_TOKEN"}, "needs": "Sentry user auth token.", "tool_tiers": {}, "untested": True},
    "supabase": {"name": "Supabase - database, auth and storage (read-only mode)", "command": [hub_presets.NPX, "-y", "@supabase/mcp-server-supabase@latest", "--read-only"],
                 "env_secrets": {"SUPABASE_ACCESS_TOKEN": "SUPABASE_ACCESS_TOKEN"}, "needs": "Supabase personal access token. Started read-only; writes are off.", "tool_tiers": {}, "untested": True},
    "stripe": {"name": "Stripe - payments, invoices, subscriptions", "command": [hub_presets.NPX, "-y", "@stripe/mcp"],
               "env_secrets": {"STRIPE_SECRET_KEY": "STRIPE_SECRET_KEY"}, "needs": "Stripe secret key. Use a restricted key (or test key) with only the permissions you want.",
               "tool_tiers": {"create_refund": "mcp.admin", "cancel_subscription": "mcp.admin", "update_subscription": "mcp.admin", "finalize_invoice": "mcp.admin",
                              "create_payment_link": "mcp.admin", "create_invoice": "mcp.admin", "update_dispute": "mcp.admin"}, "untested": True},
    "hubspot": {"name": "HubSpot - CRM contacts, companies and deals", "command": [hub_presets.NPX, "-y", "@hubspot/mcp-server"],
                "env_secrets": {"PRIVATE_APP_ACCESS_TOKEN": "HUBSPOT_ACCESS_TOKEN"}, "needs": "HubSpot private app access token.", "tool_tiers": {}, "untested": True},
    "airtable": {"name": "Airtable - bases, tables and records", "command": [hub_presets.NPX, "-y", "airtable-mcp-server"],
                 "env_secrets": {"AIRTABLE_API_KEY": "AIRTABLE_API_KEY"}, "needs": "Airtable personal access token.", "tool_tiers": {}, "untested": True},
    "todoist": {"name": "Todoist - tasks and projects", "command": [hub_presets.NPX, "-y", "@doist/todoist-mcp"],
                "env_secrets": {"TODOIST_API_KEY": "TODOIST_API_KEY"}, "needs": "Todoist API token.", "tool_tiers": {}, "untested": True},
    "resend": {"name": "Resend - send transactional email", "command": [hub_presets.NPX, "-y", "resend-mcp"],
               "env_secrets": {"RESEND_API_KEY": "RESEND_API_KEY"}, "needs": "Resend API key.", "tool_tiers": {"send-email": "mcp.admin", "send_email": "mcp.admin", "send-batch-emails": "mcp.admin"}, "untested": True},
    "figma": {"name": "Figma - read designs and components", "command": [hub_presets.NPX, "-y", "figma-developer-mcp", "--stdio"],
              "env_secrets": {"FIGMA_API_KEY": "FIGMA_API_KEY"}, "needs": "Figma personal access token.", "tool_tiers": {}, "untested": True},
    # hosted (remote) MCP servers reached through the mcp-remote bridge: first connect opens a browser sign-in. Endpoints are from the vendors' docs.
    "linear": {"name": "Linear - issues and projects (hosted, browser sign-in)", "command": [hub_presets.NPX, "-y", "mcp-remote", "https://mcp.linear.app/mcp"],
               "env_secrets": {}, "needs": "Sign in to Linear in the browser window that opens on first connect.", "tool_tiers": {}, "untested": True},
    "atlassian": {"name": "Atlassian - Jira and Confluence (hosted, browser sign-in)", "command": [hub_presets.NPX, "-y", "mcp-remote", "https://mcp.atlassian.com/v1/sse"],
                  "env_secrets": {}, "needs": "Sign in to Atlassian in the browser window that opens on first connect.", "tool_tiers": {}, "untested": True},
})
LABELS = {"BRAVE_API_KEY": "Brave Search API key", "GITHUB_TOKEN": "GitHub personal access token (fine-grained)", "SLACK_BOT_TOKEN": "Slack bot token (xoxb-...)", "SLACK_TEAM_ID": "Slack team id",
          "NOTION_TOKEN": "Notion integration token", "FIRECRAWL_API_KEY": "Firecrawl API key", "TAVILY_API_KEY": "Tavily API key", "APIFY_TOKEN": "Apify API token",
          "SENTRY_AUTH_TOKEN": "Sentry auth token", "SUPABASE_ACCESS_TOKEN": "Supabase access token", "STRIPE_SECRET_KEY": "Stripe secret/restricted key",
          "HUBSPOT_ACCESS_TOKEN": "HubSpot private app token", "AIRTABLE_API_KEY": "Airtable personal access token", "TODOIST_API_KEY": "Todoist API token",
          "RESEND_API_KEY": "Resend API key", "FIGMA_API_KEY": "Figma personal access token"}
# harmless read used to prove a connection works: (tool, arguments)
TESTS = {"google-workspace": ("gmail_search", {"query": "newer_than:1d", "max_results": 1}), "github": ("search_repositories", {"query": "repo:modelcontextprotocol/servers", "perPage": 1}),
         "filesystem": ("list_allowed_directories", {}), "memory": ("read_graph", {}), "playwright": ("browser_tabs", {"action": "list"})}
ALIASES = {"jira": "atlassian", "confluence": "atlassian", "payments": "stripe", "docs for code": "context7", "web scraping": "firecrawl", "scraper": "apify",
           "errors": "sentry", "crm": "hubspot", "tasks": "todoist", "email sending": "resend", "design": "figma", "search": "tavily", "gmail": "google-workspace", "google": "google-workspace", "calendar": "google-workspace", "google calendar": "google-workspace", "drive": "google-workspace",
           "google-calendar": "google-workspace", "files": "filesystem", "knowledge": "memory"}

# what the founder asks for ("drive", "google docs", "email"...) -> a Google capability that is proven by a real call, not by a connector label
CAPABILITY_ALIASES = {"drive": "drive", "google drive": "drive", "gdrive": "drive", "files in drive": "drive", "docs": "docs", "google docs": "docs", "document": "docs",
                      "sheets": "sheets", "google sheets": "sheets", "spreadsheet": "sheets", "gmail": "gmail", "email": "gmail", "mail": "gmail",
                      "calendar": "calendar", "google calendar": "calendar", "cloud": "cloud"}
CAPABILITIES = {"gmail": ("gmail_search", {"query": "newer_than:1d", "max_results": 1}), "calendar": ("calendar_today", {}),
                "drive": ("drive_list_recent", {"limit": 1}),
                "docs": ("drive_list_recent", {"limit": 1, "mime_type": "application/vnd.google-apps.document"}),
                "sheets": ("drive_list_recent", {"limit": 1, "mime_type": "application/vnd.google-apps.spreadsheet"})}
API_ENABLE_URL = {"drive": "https://console.cloud.google.com/apis/library/drive.googleapis.com", "docs": "https://console.cloud.google.com/apis/library/docs.googleapis.com",
                  "sheets": "https://console.cloud.google.com/apis/library/sheets.googleapis.com"}

_status: dict[str, dict] = {}


def capability_of(name: str) -> str | None:
    return CAPABILITY_ALIASES.get((name or "").strip().lower())


def catalogue() -> dict[str, dict]:
    return {**hub_presets.PRESETS, **EXTRA}


def resolve(name: str) -> str | None:
    n = (name or "").strip().lower()
    n = ALIASES.get(n, n)
    return n if n in catalogue() else None


def _env_file_values() -> dict[str, str]:
    try:
        from dotenv import dotenv_values
        return {k: v for k, v in dotenv_values(ENV_FILE).items() if v}
    except Exception:
        return {}


def find_secret(vault_name: str) -> tuple[str | None, str]:
    """Returns (value, where) with where in vault|env|none. A value found only in .env is copied into the vault."""
    v = vault.get(vault_name)
    if v:
        return v, "vault"
    v = _env_file_values().get(vault_name) or os.getenv(vault_name)
    if v:
        vault.set(vault_name, v)
        return v, "env"
    return None, "none"


async def _google_health() -> list[dict]:
    """Stored Google accounts with healthy=False when Google no longer accepts the saved login (a token row alone is not 'connected')."""
    import asyncio

    from core.services.gmail_service import accounts_with_health
    try:
        return await asyncio.to_thread(accounts_with_health)
    except Exception:
        return []


async def _google_accounts() -> list[str]:
    return [a["email"] for a in await _google_health() if a["healthy"]]


def _needs(cid: str, spec: dict) -> list[str]:
    return list(spec.get("env_secrets", {}).values())


async def check(cid: str) -> dict:
    """Cheap status (no network call to the provider): needs, what is missing, whether the hub already runs it."""
    cid = resolve(cid) or cid
    spec = catalogue().get(cid)
    if not spec:
        return {"id": cid, "known": False, "connected": False, "detail": "unknown connector"}
    missing = [n for n in _needs(cid, spec) if not find_secret(n)[0]]
    out = {"id": cid, "known": True, "name": spec["name"], "needs": spec.get("needs", ""), "secrets": [{"name": n, "label": LABELS.get(n, n)} for n in _needs(cid, spec)],
           "missing": missing, "oauth": None, "untested": bool(spec.get("untested")), "registered": cid in hub.manifests,
           "tiers": {"read": 1, "write": 2, "admin": 3}}
    if cid == "google-workspace":
        health = await _google_health()
        accounts = [a["email"] for a in health if a["healthy"]]
        expired = [a["email"] for a in health if not a["healthy"]]
        out["oauth"] = {"provider": "google", "connected": bool(accounts), "accounts": accounts, "expired": expired, "authorize_url": f"{API}/api/google/oauth/authorize"}
        if expired and not accounts:
            out["needs"] = "Your Google sign-in expired. Click Connect to sign in again."
    st = _status.get(cid, {})
    ready = not missing and (not out["oauth"] or out["oauth"]["connected"])
    out.update({"ready": ready, "connected": ready and bool(st.get("ok")), "last_test": st.get("at"), "detail": st.get("detail", ""), "tools": st.get("tools", 0)})
    return out


async def test(cid: str) -> dict:
    """Start the connector (if needed), list its tools and run the harmless read. Updates the cached status."""
    cid = resolve(cid) or cid
    st = await check(cid)
    if not st["known"]:
        return st
    if not st["ready"]:
        return {**st, "connected": False, "detail": "not ready: " + _why(st)}
    spec = catalogue()[cid]
    t0 = time.monotonic()
    try:
        if cid not in hub.manifests:
            await hub.upsert(cid, spec["name"], spec["command"], spec.get("env_secrets") or None, spec.get("tool_tiers") or None)
        conn = await hub.ensure(cid)
        n = len(conn.tools)
        detail = f"{n} tools available"
        tool = TESTS.get(cid)
        if tool and any(t["name"] == tool[0] for t in conn.tools):
            r = await hub.use_tool(f"{cid}.{tool[0]}", tool[1], agent="connector")
            if r.get("blocked") or r.get("is_error"):
                raise ToolError("test call failed: " + str(r)[:200])
            detail += f"; test read {tool[0]} ok"
        _status[cid] = {"ok": True, "at": time.time(), "detail": detail, "tools": n, "ms": int((time.monotonic() - t0) * 1000)}
    except Exception as e:
        _status[cid] = {"ok": False, "at": time.time(), "detail": f"test failed: {str(e)[:200]}", "tools": 0}
    return await check(cid)


def _why(st: dict) -> str:
    bits = []
    if st["missing"]:
        bits.append("missing " + ", ".join(st["missing"]))
    if st.get("oauth") and not st["oauth"]["connected"]:
        bits.append("Google sign-in needed")
    return "; ".join(bits)


def _oauth_request(cid: str, cap: str, reason: str) -> dict:
    return {"kind": "oauth", "connector": cid, "url": f"{API}/api/google/oauth/authorize", "provider": "google", "capability": cap, "reason": reason}


async def ensure(name: str) -> dict:
    """Make a Google capability (drive, docs, sheets, gmail, calendar) work END TO END with the least effort from the founder, then PROVE it with a real call.
    Order: signed in? -> does Google really grant the scope? (asks Google) -> is the connector process running the tools? (restart it if it predates them) -> real read.
    Returns {ok, verified, capability, evidence} on success, or {ok: False, request: <one-click card>} when only the founder can do the next step."""
    import asyncio
    import json
    import re

    from core.services import gmail_service
    cap = capability_of(name)
    if not cap:
        return await connect(name)
    if cap == "cloud":  # only ever requested to unlock automatic API enabling
        ok = (await asyncio.to_thread(gmail_service.capabilities)).get("cloud")
        return {"id": "google-workspace", "ok": bool(ok), "verified": bool(ok), "capability": "cloud", "evidence": "cloud-platform permission granted" if ok else "", "detail": "" if ok else "not granted yet"}
    cid = "google-workspace"
    st = await check(cid)
    if not st["oauth"]["connected"]:
        return {**st, "ok": False, "verified": False, "capability": cap, "request": _oauth_request(cid, cap, f"Sign in with Google to enable {cap}")}
    have = await asyncio.to_thread(gmail_service.capabilities)
    if not have.get(cap):
        return {**st, "ok": False, "verified": False, "capability": cap, "missing_scope": True,
                "request": _oauth_request(cid, cap, f"Google needs one click from you to give Jazper {cap} access (full read and write)")}
    tool, args = CAPABILITIES[cap]
    spec = catalogue()[cid]
    if cid in hub.manifests:
        conn = await hub.ensure(cid)
        if not any(t["name"] == tool for t in conn.tools):  # the connector process started before these tools existed: restart it (no founder action)
            await hub.remove(cid)
    if cid not in hub.manifests:
        await hub.upsert(cid, spec["name"], spec["command"], spec.get("env_secrets") or None, spec.get("tool_tiers") or None)
    conn = await hub.ensure(cid)
    if not any(t["name"] == tool for t in conn.tools):
        return {"id": cid, "ok": False, "verified": False, "capability": cap, "detail": f"the connector does not expose {tool}", "tools": len(conn.tools)}
    r = await hub.use_tool(f"{cid}.{tool}", args, agent="connector")
    body = json.dumps(r, default=str)
    failed = bool(r.get("blocked") or r.get("is_error") or re.search(r'\\?"error\\?":', body))
    if failed and "not enabled" in body and cap in API_ENABLE_URL:
        # the Google Cloud project has this API switched off: switch it on ourselves (needs one extra approval the first time), then retry
        if not have.get("cloud"):
            return {**st, "ok": False, "verified": False, "capability": "cloud", "missing_scope": True,
                    "request": _oauth_request(cid, "cloud", "One last click: lets Jazper switch Google APIs on by itself (no console, no more links)")}
        from core.services import gcp_service
        try:
            await asyncio.to_thread(gcp_service.enable_apis)
        except RuntimeError as e:
            return {"id": cid, "ok": False, "verified": False, "capability": cap, "detail": str(e), "fix_url": API_ENABLE_URL[cap]}
        for _ in range(12):  # the switch takes a few seconds to reach Drive/Docs/Sheets
            await asyncio.sleep(5)
            r = await hub.use_tool(f"{cid}.{tool}", args, agent="connector")
            body = json.dumps(r, default=str)
            if not (r.get("blocked") or r.get("is_error") or re.search(r'\\?"error\\?":', body)):
                failed = False
                break
    if failed:
        out = {"id": cid, "ok": False, "verified": False, "capability": cap, "detail": body[:300]}
        if "not enabled" in body and cap in API_ENABLE_URL:
            out["fix_url"] = API_ENABLE_URL[cap]
            out["detail"] = f"Google has the {cap} API switched off for this Google Cloud project. Enable it with one click here, then I continue: {API_ENABLE_URL[cap]}"
        return out
    _status[cid] = {"ok": True, "at": time.time(), "detail": f"{len(conn.tools)} tools; {cap} verified", "tools": len(conn.tools), "ms": 0}
    return {"id": cid, "ok": True, "verified": True, "capability": cap, "tools": len(conn.tools), "evidence": body[:400]}


async def connect(cid: str) -> dict:
    """Connect if possible. Returns the status plus, when something is needed from the founder, a `request`:
    {"kind":"credentials","connector":id,"secrets":[{name,label}]} or {"kind":"oauth","connector":id,"url":...}."""
    if capability_of(cid):
        return await ensure(cid)
    cid = resolve(cid) or cid
    from memory.redis import layer
    async with layer.lock("platform", f"connect:{cid}", ttl_ms=60_000, wait_s=20):  # one connect per connector at a time (Redis down -> proceeds)
        return await _connect_locked(cid)


async def _connect_locked(cid: str) -> dict:
    st = await check(cid)
    if not st["known"]:
        return st
    if st["missing"]:
        return {**st, "request": {"kind": "credentials", "connector": cid, "secrets": [s for s in st["secrets"] if s["name"] in st["missing"]]}}
    if st.get("oauth") and not st["oauth"]["connected"]:
        return {**st, "request": {"kind": "oauth", "connector": cid, "url": st["oauth"]["authorize_url"], "provider": "google"}}
    return await test(cid)


async def set_secret(cid: str, name: str, value: str) -> dict:
    cid = resolve(cid) or cid
    spec = catalogue().get(cid)
    if not spec or name not in _needs(cid, spec):
        raise KeyError(name)
    vault.set(name, value.strip())  # straight to the OS credential store; not logged, not returned
    return await check(cid)


async def disconnect(cid: str) -> dict:
    cid = resolve(cid) or cid
    if cid in hub.manifests:
        await hub.remove(cid)
    _status.pop(cid, None)
    return await check(cid)


async def autoconnect() -> None:
    """Background, after startup: bring up connectors that are already authorised (Google signed in, secrets present). Never raises."""
    import asyncio
    from core.perf import settings as perf_settings
    await asyncio.sleep(5)
    if not perf_settings.current().mcp_autoconnect:  # Performance Settings: connect on demand from the hub instead
        return
    for cid in ("google-workspace", "github", "slack", "notion"):
        try:
            st = await check(cid)
            if st.get("ready") and cid not in hub.manifests:
                await test(cid)
        except Exception:
            pass


# Recommended capabilities, most valuable first. `id` is a connectable preset; `planned` ones are ideas we do not have a verified server for yet.
RECOMMENDED = [
    {"id": "google-workspace", "why": "Gmail, Calendar and Drive: answers like 'did my incorporation email arrive' and scheduling. Highest value for a founder."},
    {"id": "github", "why": "Read repos, issues and PRs; lets the Baeit and Boardmint bots review code and open branches/PRs (writes need approval)."},
    {"id": "filesystem", "why": "Project files for the dev bots (workspaces already give folder access; this adds the standard MCP file tools)."},
    {"id": "memory", "why": "A knowledge-graph memory other MCP clients can share; optional because Jasper already has pgvector memory."},
    {"id": "slack", "why": "Notify you and the team, and take approvals from Slack instead of only in the app."},
    {"id": "notion", "why": "Company docs, specs and meeting notes as readable context."},
    {"id": "brave-search", "why": "Live web search so Jasper can answer current questions (needs a Brave Search API key)."},
    {"id": "playwright", "why": "Drive a real browser: check a website, fill forms, test the Baeit web flows (no key needed)."},
    {"id": "linear", "why": "Issue tracking for engineering work.", "planned": True},
    {"id": "jira", "why": "Issue tracking if you use Jira.", "planned": True},
    {"id": "discord", "why": "Team or community notifications.", "planned": True},
    {"id": "cashfree", "why": "Payment and payout status for Baeit (read-only first; payments would be Tier 3).", "planned": True},
    {"id": "google-sheets", "why": "Spreadsheets for finance and reporting.", "planned": True},
]


async def recommendations() -> list[dict]:
    """What to connect next, with live status. Connectable items carry what is missing so the chat can offer a one-click Connect."""
    out = []
    for r in RECOMMENDED:
        if r.get("planned") or r["id"] not in catalogue():
            out.append({"id": r["id"], "name": r["id"].replace("-", " ").title(), "why": r["why"], "status": "planned", "connectable": False})
            continue
        st = await check(r["id"])
        status = "connected" if st["connected"] else "needs credentials" if st["missing"] else "needs sign-in" if st.get("oauth") and not st["oauth"]["connected"] else "ready to connect"
        out.append({"id": r["id"], "name": st["name"], "why": r["why"], "status": status, "connectable": True, "untested": st.get("untested", False)})
    return out


async def overview() -> list[dict]:
    return [await check(cid) for cid in catalogue()]
