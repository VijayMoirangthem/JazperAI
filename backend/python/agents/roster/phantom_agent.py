"""
Phantom — Browser & Scraping Agent
Extracts structured content from URLs.

Strategy:
  1. Try fast requests + BeautifulSoup (zero dependencies beyond installed libs)
  2. Fall back to Playwright for JS-heavy pages (if available)
  3. Use AI to extract relevant information from raw HTML

Phantom never clicks forms or fills inputs — that's intentional.
Destructive browser actions require explicit user confirmation and are
handled by dedicated workers, not the conversational agent.
"""
from __future__ import annotations
import asyncio
from concurrent.futures import ThreadPoolExecutor

from agents.roster.base_agent import BaseAgent, AgentTrace
from core.providers.ai_provider import ai_provider


# ── Scraping helpers ──────────────────────────────────────────────────────────

def _scrape_requests(url: str, timeout: int = 10) -> tuple[str, str]:
    """
    Fast path: requests + BeautifulSoup.
    Returns (raw_text, error). raw_text is empty on failure.
    """
    try:
        import requests
        from bs4 import BeautifulSoup

        headers = {
            "User-Agent": (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/124.0.0.0 Safari/537.36"
            )
        }
        resp = requests.get(url, headers=headers, timeout=timeout)
        resp.raise_for_status()

        soup = BeautifulSoup(resp.text, "html.parser")

        # Remove noise
        for tag in soup(["script", "style", "nav", "footer", "header", "aside", "noscript", "svg"]):
            tag.decompose()

        # Extract meaningful text
        main = soup.find("main") or soup.find("article") or soup.find("body")
        text = main.get_text(separator="\n", strip=True) if main else soup.get_text(separator="\n", strip=True)

        # Collapse excessive whitespace
        import re
        text = re.sub(r"\n{3,}", "\n\n", text)
        return text[:8000], ""
    except ImportError:
        return "", "beautifulsoup4 not installed"
    except Exception as e:
        return "", str(e)


async def _scrape_playwright(url: str) -> tuple[str, str]:
    """
    Playwright fallback for JS-heavy pages.
    Returns (raw_text, error).
    """
    try:
        from mcp.tools.browser_tool import BrowserTool, PLAYWRIGHT_AVAILABLE
        if not PLAYWRIGHT_AVAILABLE:
            return "", "Playwright not installed"

        bt = BrowserTool(headless=True)
        await bt.start()
        try:
            ctx = await bt.new_context()
            page = await ctx.new_page()
            await page.goto(url, wait_until="domcontentloaded", timeout=20_000)
            await asyncio.sleep(2)
            text = await page.evaluate("""() => {
                const els = document.querySelectorAll('script, style, nav, footer, aside');
                els.forEach(e => e.remove());
                return document.body?.innerText || '';
            }""")
            await ctx.close()
            import re
            text = re.sub(r"\n{3,}", "\n\n", text)
            return text[:8000], ""
        finally:
            await bt.stop()
    except Exception as e:
        return "", str(e)


def _extract_urls_from_message(message: str) -> list[str]:
    """Pull URLs out of the user's message."""
    import re
    pattern = r'https?://[^\s<>"\'{}|\\^`\[\]]+'
    return re.findall(pattern, message)


class PhantomAgent(BaseAgent):
    name = "Phantom"
    emoji = "👻"
    description = (
        "Browser and web scraping agent. Call Phantom when the user provides a URL and wants "
        "to read, extract, or summarise content from that page. Also call Phantom to check "
        "job listings on specific pages, read articles, or extract structured data from websites."
    )
    model = "llama-3.1-8b-instant"

    async def _run(
        self,
        task: str,
        context: dict,
        session_id: str,
        trace: AgentTrace,
        emit,
    ) -> str:
        loop = asyncio.get_running_loop()
        _executor = context.get("_executor") or ThreadPoolExecutor(max_workers=2)

        # ── Extract URL from message ──────────────────────────────────────
        urls = _extract_urls_from_message(task)
        if not urls:
            return (
                "No URL found in your message. Please provide a URL for Phantom to visit. "
                "Example: 'Summarise https://example.com/article'"
            )

        url = urls[0]  # process first URL; multi-URL support in Phase 3

        # ── Step 1: Try fast scraping ─────────────────────────────────────
        t0 = await self._emit_tool(emit, trace, "web_scrape_fast", url, {"url": url})
        page_text, err = await loop.run_in_executor(_executor, lambda: _scrape_requests(url))

        if page_text:
            await self._emit_tool_result(
                emit, trace, "web_scrape_fast",
                f"{len(page_text)} chars extracted", {"url": url}, page_text, t0
            )
        else:
            await self._emit_tool_result(
                emit, trace, "web_scrape_fast",
                f"Failed: {err} — trying Playwright", {"url": url}, "", t0
            )

            # ── Step 2: Playwright fallback ───────────────────────────────
            t1 = await self._emit_tool(emit, trace, "web_scrape_playwright", url, {"url": url})
            page_text, err2 = await _scrape_playwright(url)
            await self._emit_tool_result(
                emit, trace, "web_scrape_playwright",
                f"{len(page_text)} chars extracted" if page_text else f"Failed: {err2}",
                {"url": url}, page_text, t1
            )

            if not page_text:
                return (
                    f"Could not scrape {url}.\n"
                    f"Fast scraper error: {err}\n"
                    f"Playwright error: {err2}\n\n"
                    "The page may require login, use bot detection, or serve content dynamically."
                )

        # ── Step 3: Extract what the user asked for ───────────────────────
        system = (
            "You are Phantom, a web content extraction assistant. "
            "Given raw page text, extract and present what the user specifically asked about. "
            "Be concise and structured. If the page contains a job listing, extract: "
            "title, company, location, salary, requirements, and how to apply. "
            "For articles: give a clear summary. For other pages: answer the user's question directly."
        )
        messages = [
            {"role": "system", "content": system},
            {
                "role": "user",
                "content": (
                    f"URL: {url}\n"
                    f"User's request: {task}\n\n"
                    f"Page content:\n{page_text}"
                ),
            },
        ]
        trace.system_prompt = system
        trace.messages_sent = [
            {"role": "system", "content": system},
            {"role": "user", "content": f"URL: {url} — {task}"},
        ]

        result = await ai_provider.chat(
            messages=messages,
            model=self.model,
            temperature=0.2,
            max_tokens=context.get("agent_overrides", {}).get("Phantom", {}).get("maxTokens") or 768,
        )

        trace.tokens_prompt = result.prompt_tokens
        trace.tokens_completion = result.completion_tokens
        trace.tokens_total = result.total_tokens

        return result.content
