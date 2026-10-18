"""
Aria — Head of Quality Assurance (IT Department, Phase 6 QA).

Aria is the single QA interface. Darwin never talks to Verdict/Probe/Pulse
directly — everything goes through Aria, who coordinates the three agents,
aggregates their results, and delivers one binary decision:

  APPROVED  — all gates passed, safe to deploy
  BLOCKED   — one or more gates failed, reason attached

QA Gate pipeline (in order):
  1. Verdict  — static diff/code review  (blocks on CRITICAL)
  2. Probe    — pytest suite              (blocks if any test fails)
  3. Pulse    — live endpoint smoke test  (warning only, not a hard block)

Aria is also scheduled for a nightly health audit (Probe + Pulse) so VJ
wakes up every morning knowing the system health at a glance.

Output contract for run_repair_gate():
  {
    "approved":      bool,
    "blocking_issue": null | "reason",
    "gates": {
      "verdict": { "safe": bool, "issues": [...], "summary": "..." },
      "probe":   { "ok": bool, "passed": int, "failed": int, "failures": [...] },
      "pulse":   { "ok": bool, "checked": int, "failed": int, "results": [...] }
    },
    "summary": "All 3 gates passed — APPROVED"  |  "Probe: 2 tests failed — BLOCKED"
  }
"""

import structlog

log = structlog.get_logger()


class AriaAgent:
    """
    QA Orchestrator — makes the final APPROVED / BLOCKED call on every
    code change before it goes live in Sir Jazper OS.

    Org chart position:
      Reports to: Darwin (AGT-0009, IT Dept Head)
      Manages:    Verdict (AGT-0040), Probe (AGT-0038), Pulse (AGT-0039)
    """

    # ── Focused gates — called individually by Darwin ─────────────────────────
    #
    # Darwin's repair flow:
    #   Oracle → Approval → Aria.gate_diff() → Forge → Aria.gate_deployment()
    #
    # Darwin's create flow:
    #   Scroll → Approval → Aria.gate_new_files() → Forge → Aria.gate_deployment()

    @classmethod
    async def gate_diff(
        cls,
        file_path: str,
        old_string: str,
        new_string: str,
        diagnosis_context: str = "",
    ) -> dict:
        """
        Pre-apply gate — runs Verdict (static diff review) only.
        Called by Darwin BEFORE Forge writes the file.

        Returns {approved, blocking_issue, verdict, summary}
        """
        from agents.roster.verdict_agent import VerdictAgent
        log.info("Aria: gate_diff", file=file_path)
        verdict = await VerdictAgent.review_diff(
            file_path=file_path,
            old_string=old_string,
            new_string=new_string,
            diagnosis_context=diagnosis_context,
        )
        critical = [i for i in verdict.get("issues", []) if i.get("severity") == "CRITICAL"]
        high     = [i for i in verdict.get("issues", []) if i.get("severity") == "HIGH"]
        if critical:
            log.warning("Aria: gate_diff BLOCKED", issue=critical[0]["description"])
            return {
                "approved": False,
                "blocking_issue": f"Verdict CRITICAL: {critical[0]['description']}",
                "verdict": verdict,
                "summary": f"Gate 1 BLOCKED — {critical[0]['description']}",
            }
        if high:
            log.warning("Aria: gate_diff HIGH (not blocking)", count=len(high))
        return {
            "approved": True,
            "blocking_issue": None,
            "verdict": verdict,
            "summary": f"Gate 1 passed — {len(high)} HIGH issue(s) noted" if high else "Gate 1 passed",
        }

    @classmethod
    async def gate_new_files(
        cls,
        files: list[dict],
        spec_context: str = "",
    ) -> dict:
        """
        Pre-create gate — runs Verdict on each new file before Forge writes them.
        Called by Darwin BEFORE Forge.create_file().

        Args:
          files: list of {"path": str, "content": str}
        Returns {approved, blocking_issue, verdict_files, summary}
        """
        from agents.roster.verdict_agent import VerdictAgent
        log.info("Aria: gate_new_files", count=len(files))
        verdict_files = []
        blocked = []
        for f in files:
            v = await VerdictAgent.review_new_file(
                file_path=f["path"],
                content=f["content"],
                spec_context=spec_context,
            )
            critical = [i for i in v.get("issues", []) if i.get("severity") == "CRITICAL"]
            verdict_files.append({"path": f["path"], "safe": v["safe"], "issues": v["issues"]})
            if critical:
                blocked.append({"path": f["path"], "issue": critical[0]["description"]})

        if blocked:
            summary = f"Gate 1 BLOCKED — {blocked[0]['path']}: {blocked[0]['issue']}"
            log.warning("Aria: gate_new_files BLOCKED", count=len(blocked))
            return {"approved": False, "blocking_issue": summary,
                    "verdict_files": verdict_files, "summary": summary}
        return {"approved": True, "blocking_issue": None,
                "verdict_files": verdict_files,
                "summary": f"Gate 1 passed — {len(files)} file(s) clean"}

    @classmethod
    async def gate_deployment(cls, run_pulse: bool = True) -> dict:
        """
        Post-apply gate — runs Probe (tests) + Pulse (endpoints).
        Called by Darwin AFTER Forge has written the file.

        Returns {approved, blocking_issue, probe, pulse, summary}
        """
        from agents.roster.probe_agent import ProbeAgent
        from agents.roster.pulse_agent import PulseAgent
        log.info("Aria: gate_deployment", run_pulse=run_pulse)

        probe = await ProbeAgent.run_suite(stop_on_first=True)
        pulse_result = {}
        if run_pulse:
            pulse_raw = await PulseAgent.check_all()
            pulse_result = {
                "ok": pulse_raw["ok"], "checked": pulse_raw["checked"],
                "failed": pulse_raw["failed"],
            }
        else:
            pulse_result = {"ok": True, "checked": 0, "failed": 0, "skipped": True}

        probe_summary = {
            "ok": probe["ok"], "passed": probe["passed"],
            "failed": probe["failed"], "errors": probe["errors"],
            "failures": probe["failures"], "duration_s": probe["duration_s"],
        }

        if not probe["ok"]:
            count = probe["failed"] or probe["errors"]
            summary = f"Gate 2 BLOCKED — {count} test(s) failing"
            log.warning("Aria: gate_deployment BLOCKED by Probe", failed=probe["failed"])
            return {"approved": False, "blocking_issue": summary,
                    "probe": probe_summary, "pulse": pulse_result, "summary": summary}

        if run_pulse and not pulse_result["ok"]:
            log.warning("Aria: Pulse warning (not blocking)", failed=pulse_result["failed"])

        passed_note = f"{probe['passed']} test(s) passing"
        pulse_note  = (f", {pulse_result['failed']} endpoint(s) degraded"
                       if run_pulse and not pulse_result["ok"] else "")
        summary = f"Gates 2+3 passed — {passed_note}{pulse_note}"
        return {"approved": True, "blocking_issue": None,
                "probe": probe_summary, "pulse": pulse_result, "summary": summary}

    # ── Combined gate — used for nightly audit and full-pipeline checks ────────

    @classmethod
    async def run_repair_gate(
        cls,
        file_path: str,
        old_string: str,
        new_string: str,
        diagnosis_context: str = "",
        run_pulse: bool = False,
    ) -> dict:
        """
        Run the full QA gate pipeline for a proposed repair diff.

        Gate 1 — Verdict (static diff review, blocks on CRITICAL)
        Gate 2 — Probe   (run tests, blocks if any test fails)
        Gate 3 — Pulse   (live endpoint check, warning only)

        Args:
          run_pulse:  Set True when Aria wants a live health snapshot after
                      applying a fix. False by default (diff not applied yet).
        """
        log.info("Aria: starting repair gate", file=file_path)

        gates = {}

        # ── Gate 1: Verdict ───────────────────────────────────────────────────
        from agents.roster.verdict_agent import VerdictAgent
        verdict = await VerdictAgent.review_diff(
            file_path=file_path,
            old_string=old_string,
            new_string=new_string,
            diagnosis_context=diagnosis_context,
        )
        gates["verdict"] = verdict

        critical = [i for i in verdict.get("issues", []) if i.get("severity") == "CRITICAL"]
        if critical:
            summary = f"Verdict BLOCKED — {critical[0]['description']}"
            log.warning("Aria: Gate 1 BLOCKED", reason=critical[0]["description"])
            return cls._result(approved=False, blocking=summary, gates=gates)

        high = [i for i in verdict.get("issues", []) if i.get("severity") == "HIGH"]
        if high:
            log.warning("Aria: Gate 1 HIGH issue (not blocking)", issue=high[0]["description"])

        # ── Gate 2: Probe ─────────────────────────────────────────────────────
        from agents.roster.probe_agent import ProbeAgent
        probe = await ProbeAgent.run_suite(stop_on_first=True)
        gates["probe"] = {
            "ok":       probe["ok"],
            "passed":   probe["passed"],
            "failed":   probe["failed"],
            "errors":   probe["errors"],
            "failures": probe["failures"],
            "duration_s": probe["duration_s"],
        }

        if not probe["ok"]:
            failure_summary = (
                f"{probe['failed']} test(s) failing"
                if probe["failed"]
                else f"{probe['errors']} error(s) in suite"
            )
            summary = f"Probe BLOCKED — {failure_summary}"
            log.warning("Aria: Gate 2 BLOCKED", failed=probe["failed"], errors=probe["errors"])
            return cls._result(approved=False, blocking=summary, gates=gates)

        # ── Gate 3: Pulse (optional — live health snapshot) ───────────────────
        if run_pulse:
            from agents.roster.pulse_agent import PulseAgent
            pulse = await PulseAgent.check_all()
            gates["pulse"] = {
                "ok":      pulse["ok"],
                "checked": pulse["checked"],
                "failed":  pulse["failed"],
            }
            if not pulse["ok"]:
                log.warning("Aria: Gate 3 Pulse warning (not blocking)",
                            failed=pulse["failed"])
                # Pulse is a warning, not a hard block
        else:
            gates["pulse"] = {"ok": True, "checked": 0, "failed": 0, "skipped": True}

        # ── All gates passed ──────────────────────────────────────────────────
        high_note = f" ({len(high)} HIGH issue(s) noted)" if high else ""
        summary = f"All QA gates passed{high_note} — APPROVED"
        log.info("Aria: APPROVED", file=file_path, high_issues=len(high))
        return cls._result(approved=True, blocking=None, gates=gates, summary=summary)

    # ── Create gate — called by Darwin before Forge creates new files ─────────

    @classmethod
    async def run_create_gate(
        cls,
        files: list[dict],
        spec_context: str = "",
    ) -> dict:
        """
        Gate each file in a self-create spec through Verdict, then run Probe.

        Args:
          files: list of {"path": str, "content": str}
        """
        log.info("Aria: starting create gate", file_count=len(files))

        gates   = {"verdict_files": [], "probe": {}, "pulse": {}}
        blocked = []

        # ── Gate 1: Verdict per file ──────────────────────────────────────────
        from agents.roster.verdict_agent import VerdictAgent
        for f in files:
            v = await VerdictAgent.review_new_file(
                file_path=f["path"],
                content=f["content"],
                spec_context=spec_context,
            )
            critical = [i for i in v.get("issues", []) if i.get("severity") == "CRITICAL"]
            gates["verdict_files"].append({
                "path":    f["path"],
                "safe":    v["safe"],
                "issues":  v["issues"],
                "summary": v["summary"],
            })
            if critical:
                blocked.append({"path": f["path"], "issue": critical[0]["description"]})

        if blocked:
            summary = f"Verdict BLOCKED {len(blocked)} file(s): {blocked[0]['issue']}"
            log.warning("Aria: create Gate 1 BLOCKED", blocks=blocked)
            return cls._result(approved=False, blocking=summary, gates=gates)

        # ── Gate 2: Probe ─────────────────────────────────────────────────────
        from agents.roster.probe_agent import ProbeAgent
        probe = await ProbeAgent.run_suite(stop_on_first=True)
        gates["probe"] = {
            "ok":       probe["ok"],
            "passed":   probe["passed"],
            "failed":   probe["failed"],
            "failures": probe["failures"],
        }

        if not probe["ok"]:
            summary = f"Probe BLOCKED — {probe['failed']} test(s) failing after file creation"
            log.warning("Aria: create Gate 2 BLOCKED", failed=probe["failed"])
            return cls._result(approved=False, blocking=summary, gates=gates)

        gates["pulse"] = {"ok": True, "checked": 0, "failed": 0, "skipped": True}
        log.info("Aria: create APPROVED", files=len(files))
        return cls._result(approved=True, blocking=None, gates=gates,
                           summary=f"All {len(files)} file(s) passed QA — APPROVED")

    # ── Nightly health audit ──────────────────────────────────────────────────

    @classmethod
    async def nightly_audit(cls) -> dict:
        """
        Run Probe (full suite) + Pulse (all endpoints).
        Called by APScheduler every night. Result is pushed as a notification.
        """
        log.info("Aria: starting nightly audit")
        from agents.roster.probe_agent import ProbeAgent
        from agents.roster.pulse_agent  import PulseAgent

        probe, pulse = await __import__("asyncio").gather(
            ProbeAgent.run_suite(),
            PulseAgent.check_all(),
        )

        overall_ok = probe["ok"] and pulse["ok"]
        summary_parts = []
        if probe["ok"]:
            summary_parts.append(f"Tests: {probe['passed']} passed")
        else:
            summary_parts.append(f"Tests: {probe['failed']} FAILED")
        if pulse["ok"]:
            summary_parts.append(f"Endpoints: {pulse['checked']} healthy")
        else:
            summary_parts.append(f"Endpoints: {pulse['failed']}/{pulse['checked']} DOWN")

        summary = " · ".join(summary_parts)
        log.info("Aria: nightly audit complete", ok=overall_ok, summary=summary)

        cls._push_audit_notification(overall_ok, summary)
        return {
            "ok":      overall_ok,
            "summary": summary,
            "probe":   probe,
            "pulse":   pulse,
        }

    # ── Internal helpers ──────────────────────────────────────────────────────

    @classmethod
    def _result(
        cls,
        approved: bool,
        blocking: str | None,
        gates: dict,
        summary: str | None = None,
    ) -> dict:
        return {
            "approved":       approved,
            "blocking_issue": blocking,
            "gates":          gates,
            "summary":        summary or (blocking or ""),
        }

    @classmethod
    def _push_audit_notification(cls, ok: bool, summary: str) -> None:
        try:
            from core.services.memory_service import _pg
            with _pg() as conn:
                cur = conn.cursor()
                cur.execute(
                    "INSERT INTO notifications (title, body, type) VALUES (%s, %s, %s)",
                    (
                        f"Aria nightly audit — {'OK' if ok else 'ISSUES FOUND'}",
                        summary,
                        "success" if ok else "warning",
                    ),
                )
                conn.commit()
                cur.close()
        except Exception as e:
            log.warning("Aria: could not push audit notification", error=str(e))
