"""Playwright-based browser automation tool for all worker agents."""
import asyncio
import random
from typing import Any
import structlog

log = structlog.get_logger()

try:
    from playwright.async_api import async_playwright, Browser, BrowserContext, Page
    PLAYWRIGHT_AVAILABLE = True
except ImportError:
    PLAYWRIGHT_AVAILABLE = False
    log.warning("Playwright not installed — browser_tool unavailable")


async def _human_delay(min_s: float = 1.5, max_s: float = 4.0) -> None:
    await asyncio.sleep(random.uniform(min_s, max_s))


class BrowserTool:
    """Manages a persistent Playwright browser instance with human-like behaviour."""

    DEFAULT_UA = (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    )

    def __init__(self, headless: bool = True, user_agent: str | None = None):
        if not PLAYWRIGHT_AVAILABLE:
            raise RuntimeError("playwright is not installed. Run: pip install playwright && playwright install chromium")
        self.headless = headless
        self.user_agent = user_agent or self.DEFAULT_UA
        self._pw = None
        self._browser: Browser | None = None

    async def start(self) -> None:
        self._pw = await async_playwright().start()
        self._browser = await self._pw.chromium.launch(headless=self.headless)
        log.info("Browser started", headless=self.headless)

    async def stop(self) -> None:
        if self._browser:
            await self._browser.close()
        if self._pw:
            await self._pw.stop()
        log.info("Browser stopped")

    async def new_context(self, cookies: list[dict] | None = None) -> BrowserContext:
        ctx = await self._browser.new_context(user_agent=self.user_agent)
        if cookies:
            await ctx.add_cookies(cookies)
        return ctx

    async def get_text(self, url: str, selector: str = "body", cookies: list[dict] | None = None) -> str:
        ctx = await self.new_context(cookies)
        page: Page = await ctx.new_page()
        try:
            await page.goto(url, wait_until="domcontentloaded", timeout=30_000)
            await _human_delay()
            el = await page.query_selector(selector)
            return (await el.inner_text()) if el else ""
        finally:
            await ctx.close()

    async def __aenter__(self):
        await self.start()
        return self

    async def __aexit__(self, *_: Any):
        await self.stop()
