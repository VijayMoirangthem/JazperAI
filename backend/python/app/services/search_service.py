import requests
import structlog

log = structlog.get_logger()

# ── Trigger detection ─────────────────────────────────────────────────────────

_SEARCH_TRIGGERS = {
    "today", "tonight", "yesterday", "tomorrow", "now", "currently", "current",
    "latest", "recent", "news", "live", "happening", "right now",
    "price", "stock", "crypto", "bitcoin", "ethereum",
    "weather", "forecast", "temperature",
    "score", "result", "match", "game",
    "released", "launched", "announced", "update",
    "2024", "2025", "2026",
    "search", "look up", "find out", "google", "research",
    "who is", "what is", "where is", "when did", "how much",
    "company", "startup", "product", "salary", "job market",
    "version", "new features", "latest version", "stable version",
    "what version", "which version", "release notes", "changelog",
    "what's new in", "whats new in",
}

_SEARCH_PATTERNS = [
    "tell me about",
    "what do you know about",
    "find me",
    "look up",
    "can you search",
]

# Questions that look like triggers but don't need a search
_NO_SEARCH_PATTERNS = [
    "what is the difference between",
    "what is a ",
    "what are ",
    "explain ",
    "how does ",
    "how do ",
    "what are the steps",
    "write me",
    "write a",
    "create a",
    "generate ",
    "code ",
    "debug ",
    "fix ",
    "calculate ",
    "what is 2",
    "what is 1",
    "what is 3",
    "what is 4",
    "what is 5",
    "define ",
]

# Hard real-time overrides — always search even if a no-search pattern matches
_HARD_TRIGGERS = {
    "today", "tonight", "now", "latest", "current", "price",
    "weather", "news", "score", "2025", "2026", "live",
}


def should_search(message: str) -> bool:
    """Return True when the message benefits from live web data."""
    lower = message.lower().strip()

    has_hard_trigger = any(t in lower for t in _HARD_TRIGGERS)

    # Skip purely instructional / coding / definitional questions
    # unless a hard real-time trigger overrides
    if not has_hard_trigger:
        if any(lower.startswith(p) for p in _NO_SEARCH_PATTERNS):
            return False

    if any(trigger in lower for trigger in _SEARCH_TRIGGERS):
        return True
    if any(p in lower for p in _SEARCH_PATTERNS):
        return True
    return False


# ── Tool definition (kept for reference) ─────────────────────────────────────

WEB_SEARCH_TOOL = {
    "type": "function",
    "function": {
        "name": "web_search",
        "description": "Search the internet for current information.",
        "parameters": {
            "type": "object",
            "properties": {
                "query": {"type": "string", "description": "Specific search query."}
            },
            "required": ["query"],
        },
    },
}


# ── Result formatter ──────────────────────────────────────────────────────────

def _format_results(results: list[dict], query: str, source: str) -> str:
    lines = [f"Search results for: {query} (via {source})\n"]
    for i, r in enumerate(results, 1):
        title = r.get("title", "")
        url = r.get("href") or r.get("url", "")
        body = r.get("body") or r.get("content") or r.get("description") or r.get("text", "")
        lines.append(f"{i}. {title}")
        if url:
            lines.append(f"   {url}")
        lines.append(f"   {body[:400]}")
        lines.append("")
    log.info(f"{source} search success", query=query, results=len(results))
    return "\n".join(lines)


# ── Provider implementations ──────────────────────────────────────────────────

def _tavily_search(query: str, max_results: int = 5) -> list[dict]:
    """Tavily — purpose-built for AI agents. Best quality, returns pre-synthesized answers."""
    from app.core.config import settings
    if not settings.TAVILY_API_KEY:
        return []
    try:
        from tavily import TavilyClient
        client = TavilyClient(api_key=settings.TAVILY_API_KEY)
        resp = client.search(query, max_results=max_results, search_depth="advanced")
        results = []
        # Prepend the direct answer if Tavily provides one
        if resp.get("answer"):
            results.append({
                "title": "Direct answer",
                "href": "",
                "body": resp["answer"],
            })
        for r in resp.get("results", []):
            results.append({
                "title": r.get("title", ""),
                "href": r.get("url", ""),
                "body": r.get("content", ""),
            })
        return results
    except Exception as e:
        log.warning("Tavily search failed", error=str(e))
        return []


def _exa_search(query: str, max_results: int = 5) -> list[dict]:
    """Exa.ai — semantic/neural search, great for research and technical content."""
    from app.core.config import settings
    if not settings.EXA_AI_API_KEY:
        return []
    try:
        from exa_py import Exa
        exa = Exa(api_key=settings.EXA_AI_API_KEY)
        resp = exa.search_and_contents(
            query,
            num_results=max_results,
            use_autoprompt=True,
            text={"max_characters": 400},
        )
        results = []
        for r in resp.results:
            results.append({
                "title": r.title or "",
                "href": r.url or "",
                "body": r.text or "",
            })
        return results
    except Exception as e:
        log.warning("Exa search failed", error=str(e))
        return []


def _google_search(query: str, max_results: int = 5) -> list[dict]:
    """Google Custom Search API — 100 free queries/day."""
    from app.core.config import settings
    if not settings.GOOGLE_CUSTOM_SEARCH_API or not settings.GOOGLE_CSE_ID:
        return []
    try:
        r = requests.get(
            "https://www.googleapis.com/customsearch/v1",
            params={
                "key": settings.GOOGLE_CUSTOM_SEARCH_API,
                "cx": settings.GOOGLE_CSE_ID,
                "q": query,
                "num": min(max_results, 10),
            },
            timeout=10,
        )
        if r.status_code != 200:
            log.warning("Google search non-200", status=r.status_code)
            return []
        items = r.json().get("items", [])
        return [
            {
                "title": item.get("title", ""),
                "href": item.get("link", ""),
                "body": item.get("snippet", ""),
            }
            for item in items[:max_results]
        ]
    except Exception as e:
        log.warning("Google search failed", error=str(e))
        return []


def _ddg_search(query: str, max_results: int = 5) -> list[dict]:
    """DuckDuckGo — no API key, inconsistent quality, used as last paid-free fallback."""
    try:
        from ddgs import DDGS
        d = DDGS()
        _version_hints = ("version", "release", "new feature", "latest", "changelog", "what's new")
        tl = "y" if any(h in query.lower() for h in _version_hints) else None
        return list(d.text(query, max_results=max_results, timelimit=tl))
    except Exception as e:
        log.warning("DuckDuckGo search failed", error=str(e))
        return []


def _wikipedia_search(query: str) -> str | None:
    try:
        r = requests.get(
            "https://en.wikipedia.org/w/api.php",
            params={"action": "query", "list": "search", "srsearch": query,
                    "format": "json", "srlimit": 1},
            timeout=8,
        )
        results = r.json().get("query", {}).get("search", [])
        if not results:
            return None
        title = results[0]["title"]
        summary_r = requests.get(
            f"https://en.wikipedia.org/api/rest_v1/page/summary/{requests.utils.quote(title)}",
            timeout=8,
        )
        data = summary_r.json()
        extract = data.get("extract", "")
        return f"Wikipedia — {title}: {extract[:1000]}" if extract else None
    except Exception as e:
        log.warning("Wikipedia search failed", error=str(e))
        return None


# ── Main search orchestrator ──────────────────────────────────────────────────

def run_search(query: str) -> str:
    """
    Priority chain: Tavily → Exa → Google → DuckDuckGo → Wikipedia
    Each provider is skipped if its API key is not configured.
    Returns a formatted text block ready for LLM injection.
    """
    # 1. Tavily (best — AI-native, pre-synthesized answers)
    try:
        results = _tavily_search(query)
        if results:
            return _format_results(results, query, "Tavily")
    except Exception as e:
        log.warning("Tavily failed", error=str(e))

    # 2. Exa (semantic search, great for technical/research queries)
    try:
        results = _exa_search(query)
        if results:
            return _format_results(results, query, "Exa")
    except Exception as e:
        log.warning("Exa failed", error=str(e))

    # 3. Google Custom Search (Google quality, 100/day free)
    try:
        results = _google_search(query)
        if results:
            return _format_results(results, query, "Google")
    except Exception as e:
        log.warning("Google failed", error=str(e))

    # 4. DuckDuckGo (no key needed, quality varies)
    try:
        results = _ddg_search(query)
        if results:
            return _format_results(results, query, "DuckDuckGo")
    except Exception as e:
        log.warning("DuckDuckGo failed", error=str(e))

    # 5. Wikipedia (encyclopedic fallback)
    wiki = _wikipedia_search(query)
    if wiki:
        log.info("Wikipedia fallback used", query=query)
        return wiki

    log.warning("All search sources failed", query=query)
    return f"Search unavailable right now. Could not retrieve results for: {query}"
