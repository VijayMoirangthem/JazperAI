"""
Voyager — Autonomous Browser Agent (Phase 7C)

Department: IT Department
Level: L3 (reports to Darwin)
Role: Visual testing, UI verification, end-to-end golden path flows

Voyager uses Playwright to open a headless Chromium browser, navigate the app,
screenshot each panel, read console errors, and return structured PASS/FAIL reports.

Darwin calls Voyager after a successful repair to visually confirm the fix didn't
break the UI.

Usage:
  result = await VoyagerAgent.test_panel("chat", "http://localhost:3000/#chat")
  report = await VoyagerAgent.run_golden_path()
"""

from __future__ import annotations

import asyncio
import base64
import datetime
import structlog

log = structlog.get_logger()

# URL for the COOS frontend
_FRONTEND_URL = "http://localhost:3001"

# Golden path: panel → (hash, selector to wait for, action_description)
_GOLDEN_PATH: list[dict] = [
    {"panel": "dashboard",     "hash": "dashboard",     "wait_for": ".sj-panel",         "desc": "Dashboard loads"},
    {"panel": "chat",          "hash": "chat",          "wait_for": ".sj-panel",         "desc": "Chat panel loads"},
    {"panel": "tasks",         "hash": "tasks",         "wait_for": ".sj-panel",         "desc": "Tasks panel loads"},
    {"panel": "notifications", "hash": "notifications", "wait_for": ".sj-panel",         "desc": "Notifications loads"},
    {"panel": "observatory",   "hash": "observatory",   "wait_for": ".sj-panel",         "desc": "Observatory loads"},
    {"panel": "it_dept",       "hash": "it_dept",       "wait_for": ".sj-panel",         "desc": "IT Department loads"},
]

# In-memory store for the last Voyager run results (used by Control Tower)
_last_run: dict = {
    "timestamp": None,
    "panels":    [],
    "summary":   {"passed": 0, "failed": 0, "errors": []},
}

# SSE subscribers (Control Tower Browser tab)
_subs: list = []


def add_subscriber(q) -> None:
    _subs.append(q)


def remove_subscriber(q) -> None:
    try:
        _subs.remove(q)
    except ValueError:
        pass


def _push_event(event: dict) -> None:
    import json
    dead = []
    for q in _subs:
        try:
            q.put_nowait(json.dumps(event))
        except Exception:
            dead.append(q)
    for q in dead:
        try:
            _subs.remove(q)
        except ValueError:
            pass


def get_last_run() -> dict:
    return _last_run


class VoyagerAgent:

    @classmethod
    async def test_panel(
        cls,
        panel: str,
        url: str | None = None,
        *,
        headless: bool = True,
        timeout_ms: int = 15_000,
    ) -> dict:
        """
        Navigate to a panel, screenshot it, check for JS console errors.

        Returns:
          {
            "panel": str,
            "url": str,
            "ok": bool,
            "screenshot_b64": str | None,  # PNG as base64
            "console_errors": list[str],
            "duration_ms": int,
            "error": str | None,           # Python-level error
          }
        """
        from core.services.ide_bus import ide_bus

        target_url = url or f"{_FRONTEND_URL}/#{panel}"
        start = datetime.datetime.utcnow()

        ide_bus.emit({
            "agent":   "Voyager",
            "action":  "screenshot",
            "summary": f"Testing {panel}",
            "file":    target_url,
        })

        result: dict = {
            "panel":          panel,
            "url":            target_url,
            "ok":             False,
            "screenshot_b64": None,
            "console_errors": [],
            "duration_ms":    0,
            "error":          None,
        }

        try:
            from playwright.async_api import async_playwright, Error as PlaywrightError  # type: ignore
        except ImportError:
            result["error"] = "playwright not installed — run: playwright install chromium"
            log.warning("Voyager: playwright not available")
            return result

        try:
            async with async_playwright() as pw:
                browser = await pw.chromium.launch(headless=headless)
                context = await browser.new_context(
                    viewport={"width": 1440, "height": 900},
                )
                page = await context.new_page()

                # Collect console errors
                console_errors: list[str] = []

                def on_console(msg):
                    if msg.type == "error":
                        console_errors.append(msg.text)

                page.on("console", on_console)

                # Navigate
                try:
                    await page.goto(target_url, timeout=timeout_ms, wait_until="networkidle")
                except PlaywrightError:
                    # networkidle can time out on slow pages — fall back to domcontentloaded
                    await page.goto(target_url, timeout=timeout_ms, wait_until="domcontentloaded")

                # Wait for the panel content
                try:
                    await page.wait_for_selector(".sj-panel", timeout=8_000)
                except PlaywrightError:
                    pass  # panel may not have .sj-panel — continue with screenshot

                # Extra settle time
                await asyncio.sleep(1.5)

                # Screenshot
                screenshot_bytes = await page.screenshot(full_page=False)
                result["screenshot_b64"] = base64.b64encode(screenshot_bytes).decode()
                result["console_errors"] = console_errors
                result["ok"]             = len(console_errors) == 0

                await browser.close()

        except Exception as exc:
            result["error"] = str(exc)
            log.error("Voyager: panel test failed", panel=panel, error=str(exc))

        elapsed = int((datetime.datetime.utcnow() - start).total_seconds() * 1000)
        result["duration_ms"] = elapsed

        # Emit result to IDE bus
        ide_bus.emit({
            "agent":   "Voyager",
            "action":  "result",
            "summary": f"{panel} → {'PASS' if result['ok'] else 'FAIL'}",
            "ok":      result["ok"],
            "output":  f"{len(result['console_errors'])} console error(s). {result.get('error','')}"[:200],
        })

        # Push to Control Tower SSE
        _push_event({
            "type":      "panel_result",
            "panel":     panel,
            "ok":        result["ok"],
            "has_shot":  result["screenshot_b64"] is not None,
            "errors":    result["console_errors"][:3],
            "duration_ms": elapsed,
            "ts":        start.isoformat() + "Z",
        })

        log.info("Voyager: panel test complete", panel=panel, ok=result["ok"],
                 console_errors=len(result["console_errors"]), duration_ms=elapsed)
        return result

    @classmethod
    async def run_golden_path(
        cls,
        panels: list[str] | None = None,
        *,
        headless: bool = True,
    ) -> dict:
        """
        Run the golden path test suite for all (or specified) panels.

        Returns:
          {
            "ok": bool,           # all panels passed
            "panels": list[dict], # per-panel results
            "summary": {...},
          }
        """
        global _last_run

        targets = (
            [p for p in _GOLDEN_PATH if p["panel"] in panels]
            if panels
            else _GOLDEN_PATH
        )

        log.info("Voyager: running golden path", count=len(targets))

        results = []
        for target in targets:
            r = await cls.test_panel(
                target["panel"],
                headless=headless,
            )
            results.append(r)
            # Brief pause between panels to avoid overwhelming the frontend
            await asyncio.sleep(0.5)

        passed = sum(1 for r in results if r["ok"])
        failed = len(results) - passed
        all_ok = failed == 0

        summary = {
            "passed": passed,
            "failed": failed,
            "errors": [
                f"{r['panel']}: {r['console_errors'][0][:100]}"
                for r in results
                if not r["ok"] and r["console_errors"]
            ],
        }

        _last_run = {
            "timestamp": datetime.datetime.utcnow().isoformat() + "Z",
            "panels":    results,
            "summary":   summary,
        }

        log.info("Voyager: golden path complete", passed=passed, failed=failed)
        return {"ok": all_ok, "panels": results, "summary": summary}

    @classmethod
    async def verify_panel_after_repair(cls, affected_file: str) -> dict:
        """
        Called by Darwin after a successful repair.
        Heuristically maps the repaired file to the most relevant panel and tests it.
        """
        # Map common file patterns to panels
        file_lower = affected_file.lower()
        panel = "dashboard"  # default

        if "chat" in file_lower:
            panel = "chat"
        elif "task" in file_lower:
            panel = "tasks"
        elif "job" in file_lower:
            panel = "jobs"
        elif "notif" in file_lower:
            panel = "notifications"
        elif "observatory" in file_lower or "worker" in file_lower:
            panel = "observatory"
        elif "it_dept" in file_lower or "darwin" in file_lower or "oracle" in file_lower or "forge" in file_lower:
            panel = "it_dept"

        log.info("Voyager: post-repair check", file=affected_file, panel=panel)
        return await cls.test_panel(panel)
