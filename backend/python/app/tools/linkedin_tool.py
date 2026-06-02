"""
LinkedIn automation via Playwright + session cookies.

Usage:
  1. User logs into LinkedIn in their browser.
  2. User exports cookies as JSON (e.g. via Cookie-Editor extension).
  3. User pastes JSON into the Credentials tab (portal = "linkedin").
  4. This tool loads those cookies before each session — no OAuth needed.
"""
import asyncio
import random
import structlog
from typing import Any

log = structlog.get_logger()


class LinkedInTool:
    LOGIN_URL = "https://www.linkedin.com/feed/"
    JOBS_SEARCH_URL = "https://www.linkedin.com/jobs/search/"

    def __init__(self, cookies: list[dict], user_agent: str | None = None):
        self.cookies = cookies
        self.user_agent = user_agent

    async def _make_context(self, browser_tool):
        return await browser_tool.new_context(cookies=self.cookies)

    async def test_session(self, browser_tool) -> dict:
        """Load LinkedIn feed and check if still logged in. Returns {ok, name}."""
        ctx = await self._make_context(browser_tool)
        page = await ctx.new_page()
        try:
            await page.goto(self.LOGIN_URL, wait_until="domcontentloaded", timeout=30_000)
            await asyncio.sleep(random.uniform(2, 4))

            # If redirected to login page, session is expired
            if "login" in page.url or "checkpoint" in page.url:
                return {"ok": False, "name": None, "error": "Session expired — please refresh cookies"}

            # Try to grab the user's name from the nav
            name_el = await page.query_selector(".global-nav__me-photo")
            alt = await name_el.get_attribute("alt") if name_el else None
            return {"ok": True, "name": alt or "LinkedIn User"}
        except Exception as e:
            return {"ok": False, "name": None, "error": str(e)}
        finally:
            await ctx.close()

    async def search_jobs(
        self,
        browser_tool,
        title: str,
        location: str = "",
        remote: bool = False,
        limit: int = 20,
    ) -> list[dict]:
        """Search LinkedIn Jobs and return a list of job dicts."""
        from urllib.parse import urlencode

        params = {"keywords": title, "location": location}
        if remote:
            params["f_WT"] = "2"
        url = self.JOBS_SEARCH_URL + "?" + urlencode(params)

        ctx = await self._make_context(browser_tool)
        page = await ctx.new_page()
        jobs: list[dict] = []
        try:
            await page.goto(url, wait_until="domcontentloaded", timeout=30_000)
            await asyncio.sleep(random.uniform(2, 4))

            cards = await page.query_selector_all(".job-card-container")
            for card in cards[:limit]:
                try:
                    title_el = await card.query_selector(".job-card-list__title")
                    company_el = await card.query_selector(".job-card-container__company-name")
                    loc_el = await card.query_selector(".job-card-container__metadata-item")
                    link_el = await card.query_selector("a")
                    jobs.append({
                        "title": (await title_el.inner_text()).strip() if title_el else "",
                        "company": (await company_el.inner_text()).strip() if company_el else "",
                        "location": (await loc_el.inner_text()).strip() if loc_el else "",
                        "url": await link_el.get_attribute("href") if link_el else "",
                    })
                except Exception:
                    continue
        except Exception as e:
            log.warning("LinkedIn job search failed", error=str(e))
        finally:
            await ctx.close()

        return jobs

    async def easy_apply(self, browser_tool, job_url: str, profile: dict) -> dict:
        """
        Attempt LinkedIn Easy Apply for a single job listing.
        Returns {success, message}.
        """
        ctx = await self._make_context(browser_tool)
        page = await ctx.new_page()
        try:
            await page.goto(job_url, wait_until="domcontentloaded", timeout=30_000)
            await asyncio.sleep(random.uniform(2, 4))

            # Click Easy Apply button
            btn = await page.query_selector(".jobs-apply-button")
            if not btn:
                return {"success": False, "message": "No Easy Apply button found"}

            await btn.click()
            await asyncio.sleep(random.uniform(1.5, 3))

            # Handle multi-step form — click Next until Submit appears
            for _ in range(10):
                submit = await page.query_selector("button[aria-label='Submit application']")
                if submit:
                    await submit.click()
                    await asyncio.sleep(random.uniform(2, 4))
                    return {"success": True, "message": "Applied via Easy Apply"}

                next_btn = await page.query_selector("button[aria-label='Continue to next step']")
                if next_btn:
                    await next_btn.click()
                    await asyncio.sleep(random.uniform(1.5, 3))
                else:
                    break

            return {"success": False, "message": "Could not complete Easy Apply form"}
        except Exception as e:
            return {"success": False, "message": str(e)}
        finally:
            await ctx.close()
