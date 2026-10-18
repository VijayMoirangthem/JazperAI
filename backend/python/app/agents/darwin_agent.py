"""
Darwin — IT Department Coordinator (Stage 1: Repair, Stage 2: Create).

Darwin is the orchestrator. It never writes code itself — it delegates:
  Oracle  → diagnose the bug
  Forge   → apply the fix / create files
  Shield  → run tests
  Scroll  → write feature specs

Stage 3: Autonomous repairs
  If the error type is in AUTONOMOUS_TYPES and Oracle's confidence >= 0.85,
  Darwin skips the approval step and self-heals without waking the user.

Entry points:
  await DarwinAgent.handle_repair(error_id)
  await DarwinAgent.handle_create(description, requester)
"""

import asyncio
import json
import uuid
import datetime
import structlog

from app.agents.oracle_agent    import OracleAgent
from app.agents.forge_agent     import ForgeAgent
from app.agents.scroll_agent    import ScrollAgent
from app.agents.aria_agent      import AriaAgent      # QA orchestrator — single QA interface
from app.agents.commander_agent import CommanderAgent  # Phase 7A — terminal access

log = structlog.get_logger()

# Stage 3: error types Claude can fix autonomously with high confidence
AUTONOMOUS_TYPES = {
    "SyntaxError",        # f-string quotes, missing colons, brackets
    "IndentationError",   # bad indentation
    "TabError",           # tabs vs spaces
    "NameError",          # undefined variable / typo in name
    "AttributeError",     # wrong attribute name
    "ImportError",        # wrong import path / missing alias
    "ModuleNotFoundError",
}

# Confidence threshold for autonomous repair (Claude returns 0.9+ on clear fixes)
AUTONOMOUS_CONFIDENCE = 0.85


class DarwinAgent:

    # ── Repair workflow (Stage 1 + 3) ─────────────────────────────────────────

    @classmethod
    async def handle_repair(cls, error_id: str) -> dict:
        """
        Full repair workflow for a recorded agent error.
        Returns the IT ticket dict on completion.
        """
        from app.services.error_store import error_store

        log.info("Darwin: starting repair", error_id=error_id)

        # ── 1. Retrieve the error ─────────────────────────────────────────────
        err = error_store.get_by_id(error_id)
        if not err:
            return {"ok": False, "error": f"Error {error_id} not found in store"}

        ticket_id = str(uuid.uuid4())

        # ── 2. Create IT ticket (status: diagnosing) ──────────────────────────
        await cls._upsert_ticket(ticket_id, {
            "type": "repair", "status": "diagnosing",
            "trigger_text": err.error_message[:500],
            "traceback": err.traceback_str[:3000],
        })

        # ── 3. Oracle diagnoses ───────────────────────────────────────────────
        diagnosis = await OracleAgent.diagnose(err.error_message, err.traceback_str)
        await cls._upsert_ticket(ticket_id, {
            "diagnosis": json.dumps(diagnosis),
            "affected_files": json.dumps([diagnosis.get("file_path")] if diagnosis.get("file_path") else []),
            "proposed_changes": json.dumps([{
                "file_path":  diagnosis.get("file_path"),
                "old_string": diagnosis.get("old_string"),
                "new_string": diagnosis.get("new_string"),
            }]) if diagnosis.get("old_string") else json.dumps([]),
        })

        confidence  = diagnosis.get("confidence", 0.0)
        error_type  = cls._extract_error_type(err.error_message)
        is_fixable  = (
            diagnosis.get("old_string")
            and diagnosis.get("new_string")
            and diagnosis.get("file_path")
        )

        if not is_fixable or confidence < 0.5:
            await cls._upsert_ticket(ticket_id, {
                "status": "needs_human",
                "resolution_note": f"Oracle confidence too low ({confidence:.2f}) or no fix proposed.",
            })
            log.info("Darwin: cannot auto-fix, marked needs_human", ticket=ticket_id)
            return {"ok": False, "ticket_id": ticket_id, "reason": "low_confidence"}

        # ── 4. Autonomous vs approval (Stage 3 vs Stage 1) ───────────────────
        autonomous = (
            error_type in AUTONOMOUS_TYPES
            and confidence >= AUTONOMOUS_CONFIDENCE
        )

        if autonomous:
            log.info("Darwin: autonomous repair — skipping approval",
                     error_type=error_type, confidence=confidence)
            approved = True
        else:
            await cls._upsert_ticket(ticket_id, {"status": "awaiting_approval"})
            approved = await cls._request_approval(
                ticket_id, diagnosis, err.error_message
            )

        if not approved:
            await cls._upsert_ticket(ticket_id, {"status": "rejected"})
            log.info("Darwin: repair rejected by user", ticket=ticket_id)
            return {"ok": False, "ticket_id": ticket_id, "reason": "rejected"}

        # ── 5. Aria Gate 1 — Verdict audits the diff (pre-apply) ─────────────
        await cls._upsert_ticket(ticket_id, {"status": "auditing"})
        gate1 = await AriaAgent.gate_diff(
            file_path=diagnosis["file_path"],
            old_string=diagnosis["old_string"],
            new_string=diagnosis["new_string"],
            diagnosis_context=diagnosis.get("diagnosis", "")[:400],
        )
        await cls._upsert_ticket(ticket_id, {
            "diagnosis": json.dumps({**json.loads(
                (await cls._get_ticket_field(ticket_id, "diagnosis")) or "{}"
            ), "gate1": gate1}),
        })

        if not gate1["approved"]:
            await cls._upsert_ticket(ticket_id, {
                "status": "needs_human",
                "resolution_note": gate1["blocking_issue"],
            })
            log.warning("Darwin: Aria Gate 1 blocked", ticket=ticket_id,
                        reason=gate1["blocking_issue"])
            return {"ok": False, "ticket_id": ticket_id, "reason": "qa_gate1_blocked"}

        # ── 6. Forge applies the fix ──────────────────────────────────────────
        await cls._upsert_ticket(ticket_id, {"status": "applying"})
        forge_result = await ForgeAgent.apply_fix(
            diagnosis["file_path"],
            diagnosis["old_string"],
            diagnosis["new_string"],
        )

        if not forge_result["ok"]:
            await cls._upsert_ticket(ticket_id, {
                "status": "failed",
                "resolution_note": f"Forge failed: {forge_result['error']}",
            })
            return {"ok": False, "ticket_id": ticket_id, "reason": "forge_failed"}

        bak_path = forge_result.get("bak_path")

        # ── 7. Commander runs pytest → Aria Gates 2+3 evaluate the output ───
        await cls._upsert_ticket(ticket_id, {"status": "testing"})
        # Phase 7A: Commander is the canonical test runner — output streams
        # to Control Tower terminal so the user can watch it live.
        try:
            await CommanderAgent.run(
                command="python -m pytest tests/ -q --tb=short",
                cwd="backend/python",
                caller="Darwin",
                reason=f"Post-fix verification for ticket {ticket_id}",
                timeout=180,
            )
        except Exception as cmd_exc:
            log.warning("Darwin: Commander pytest run failed — Aria will re-run",
                        error=str(cmd_exc))
        gate23 = await AriaAgent.gate_deployment(run_pulse=False)
        await cls._upsert_ticket(ticket_id, {
            "test_results": json.dumps(gate23["probe"]),
        })

        if not gate23["approved"]:
            if bak_path:
                await ForgeAgent.restore(bak_path)
            await cls._upsert_ticket(ticket_id, {
                "status": "failed",
                "resolution_note": f"{gate23['blocking_issue']}. Rolled back.",
            })
            log.warning("Darwin: Aria Gate 2 blocked — rolled back", ticket=ticket_id)
            return {"ok": False, "ticket_id": ticket_id, "reason": "qa_gate2_blocked"}

        # ── 8. Success ────────────────────────────────────────────────────────
        passed = gate23["probe"].get("passed", 0)
        await cls._upsert_ticket(ticket_id, {
            "status": "resolved", "applied": True,
            "user_approved": True,
            "resolution_note": f"QA gates passed. Tests: {passed} passing.",
            "resolved_at": datetime.datetime.utcnow().isoformat(),
        })
        await error_store.mark_resolved(error_id)
        error_store.clear_consecutive(err.agent)

        # ── Phase 7B: signal Watchdog to restart backend so fix takes effect ──
        try:
            from app.system.process_manager import signal_watchdog
            signal_watchdog(target="backend",
                            reason=f"Darwin repair complete for ticket {ticket_id}")
        except Exception as wdog_exc:
            log.warning("Darwin: watchdog signal failed (non-fatal)", error=str(wdog_exc))

        # ── Phase 7C: Voyager verifies the UI wasn't broken by the fix ───────
        # Give uvicorn ~5s to restart before testing the frontend.
        # Voyager runs fire-and-forget so Darwin doesn't block on it.
        try:
            from app.agents.voyager_agent import VoyagerAgent
            affected_file = diagnosis.get("file_path", "")
            asyncio.create_task(
                VoyagerAgent.verify_panel_after_repair(affected_file),
                name=f"voyager-verify-{ticket_id[:8]}",
            )
        except Exception as voy_exc:
            log.warning("Darwin: Voyager task creation failed (non-fatal)", error=str(voy_exc))

        log.info("Darwin: repair complete", ticket=ticket_id,
                 tests_passed=passed)
        return {"ok": True, "ticket_id": ticket_id, "autonomous": autonomous}

    # ── Create workflow (Stage 2) ─────────────────────────────────────────────

    @classmethod
    async def handle_create(cls, description: str, requester: str = "user") -> dict:
        """
        Self-Create workflow: Scroll writes spec → approval → Forge creates files → Shield validates.
        """
        ticket_id = str(uuid.uuid4())
        log.info("Darwin: starting create", requester=requester)

        await cls._upsert_ticket(ticket_id, {
            "type": "create", "status": "speccing",
            "trigger_text": description[:500],
        })

        # ── 1. Scroll writes the spec ─────────────────────────────────────────
        spec = await ScrollAgent.write_spec(description)
        files_to_create = spec.get("files_to_create", [])

        await cls._upsert_ticket(ticket_id, {
            "diagnosis": json.dumps({"spec": spec.get("spec"), "risk": spec.get("risk")}),
            "new_files":  json.dumps(files_to_create),
            "status": "awaiting_approval" if not spec.get("error") else "failed",
        })

        if spec.get("error") or not files_to_create:
            await cls._upsert_ticket(ticket_id, {
                "status": "failed",
                "resolution_note": spec.get("error") or "No files generated.",
            })
            return {"ok": False, "ticket_id": ticket_id, "reason": "scroll_failed"}

        # ── 2. Request approval ───────────────────────────────────────────────
        approved = await cls._request_create_approval(ticket_id, description, files_to_create)

        if not approved:
            await cls._upsert_ticket(ticket_id, {"status": "rejected"})
            return {"ok": False, "ticket_id": ticket_id, "reason": "rejected"}

        # ── 3. Aria Gate 1 — Verdict audits each new file (pre-create) ──────
        await cls._upsert_ticket(ticket_id, {"status": "auditing"})
        gate1 = await AriaAgent.gate_new_files(
            files=files_to_create,
            spec_context=spec.get("spec", "")[:300],
        )

        if not gate1["approved"]:
            await cls._upsert_ticket(ticket_id, {
                "status": "needs_human",
                "resolution_note": gate1["blocking_issue"],
            })
            log.warning("Darwin: Aria Gate 1 blocked create", ticket=ticket_id,
                        reason=gate1["blocking_issue"])
            return {"ok": False, "ticket_id": ticket_id, "reason": "qa_gate1_blocked"}

        # ── 4. Forge creates files ────────────────────────────────────────────
        await cls._upsert_ticket(ticket_id, {"status": "creating"})
        failed_files = []
        for f in files_to_create:
            result = await ForgeAgent.create_file(f["path"], f["content"])
            if not result["ok"]:
                failed_files.append({"path": f["path"], "error": result["error"]})

        if failed_files:
            await cls._upsert_ticket(ticket_id, {
                "status": "partial",
                "resolution_note": f"Some files failed: {failed_files}",
            })
        else:
            # ── 5. Aria Gates 2+3 — Probe + Pulse (post-create) ──────────────
            await cls._upsert_ticket(ticket_id, {"status": "testing"})
            gate23 = await AriaAgent.gate_deployment(run_pulse=False)
            probe  = gate23["probe"]

            if not gate23["approved"]:
                await cls._upsert_ticket(ticket_id, {
                    "test_results":  json.dumps(probe),
                    "status":        "test_failed",
                    "applied":       True,
                    "user_approved": True,
                    "resolved_at":   datetime.datetime.utcnow().isoformat(),
                    "resolution_note": f"Files created but {gate23['blocking_issue']}.",
                })
                return {"ok": True, "ticket_id": ticket_id, "files": len(files_to_create),
                        "probe_failed": True}

            # ── 6. Commander — install deps + launch the built app ────────────
            project_root = cls._detect_project_root(files_to_create)
            voyager_result = None

            if project_root:
                await cls._upsert_ticket(ticket_id, {"status": "launching"})
                voyager_result = await cls._launch_and_verify(
                    ticket_id, files_to_create, project_root
                )

            await cls._upsert_ticket(ticket_id, {
                "test_results":  json.dumps({
                    **probe,
                    "voyager": voyager_result,
                }),
                "status":        "resolved",
                "applied":       True,
                "user_approved": True,
                "resolved_at":   datetime.datetime.utcnow().isoformat(),
                "resolution_note": (
                    f"Created {len(files_to_create)} file(s). "
                    f"Tests: {probe.get('passed', 0)} passing. "
                    + (
                        f"Browser: {'PASS' if voyager_result and voyager_result.get('ok') else 'SKIP'}."
                        if voyager_result
                        else "Browser test skipped."
                    )
                ),
            })

        return {"ok": True, "ticket_id": ticket_id, "files": len(files_to_create)}

    # ── Phase 7: Launch + Verify helpers ─────────────────────────────────────

    @classmethod
    def _detect_project_root(cls, files: list[dict]) -> str | None:
        """
        From the list of created files, infer the external project root dir.
        Returns the common ancestor path if it's outside the COOS project, else None.
        """
        import os
        from pathlib import Path
        coos_root = Path(__file__).parent.parent.parent.parent.parent.resolve()
        paths = [Path(f["path"]).resolve() for f in files if f.get("path")]
        external = [p for p in paths if not p.is_relative_to(coos_root)]
        if not external:
            return None
        # Common ancestor of all external files
        try:
            root = external[0]
            for p in external[1:]:
                while not p.is_relative_to(root) and root != root.parent:
                    root = root.parent
            return str(root)
        except Exception:
            return None

    @classmethod
    def _detect_app_type(cls, files: list[dict]) -> dict:
        """
        Inspect created file paths/contents to decide what kind of app was built
        and what commands are needed to install, start, and test it.

        Returns:
          {
            "has_backend":  bool,
            "has_frontend": bool,
            "backend_dir":  str | None,   # absolute path
            "frontend_dir": str | None,   # absolute path
            "backend_url":  str | None,   # e.g. http://localhost:8001
            "frontend_url": str | None,   # e.g. http://localhost:5173
            "backend_port": int | None,
            "frontend_port": int | None,
          }
        """
        import re
        from pathlib import Path

        paths = [f.get("path", "") for f in files]
        # Exclude node_modules content so package names like "react" don't create false positives
        contents = " ".join(
            f.get("content", "")[:500] for f in files
            if "node_modules" not in f.get("path", "")
        )

        has_requirements = any("requirements.txt" in p for p in paths)
        has_package_json = any("package.json" in p and "node_modules" not in p for p in paths)
        has_fastapi      = "fastapi" in contents.lower() or "uvicorn" in contents.lower()
        has_react        = "react" in contents.lower() or "vite" in contents.lower()

        # Infer backend dir (directory of requirements.txt or main.py)
        backend_dir = None
        for p in paths:
            if "requirements.txt" in p or (p.endswith("main.py") and "fastapi" in contents.lower()):
                backend_dir = str(Path(p).parent.resolve())
                break

        # Infer frontend dir (directory of package.json)
        frontend_dir = None
        for p in paths:
            if "package.json" in p and "node_modules" not in p:
                frontend_dir = str(Path(p).parent.resolve())
                break

        # Detect ports from content (e.g. "--port 8001")
        backend_port  = 8001
        frontend_port = 5173
        m = re.search(r"--port[= ](\d{4,5})", contents)
        if m:
            backend_port = int(m.group(1))
        m = re.search(r"port[\"']?\s*:\s*(\d{4,5})", contents)
        if m:
            frontend_port = int(m.group(1))

        return {
            "has_backend":  has_requirements or has_fastapi,
            "has_frontend": has_package_json or has_react,
            "backend_dir":  backend_dir,
            "frontend_dir": frontend_dir,
            "backend_url":  f"http://localhost:{backend_port}" if (has_requirements or has_fastapi) else None,
            "frontend_url": f"http://localhost:{frontend_port}" if (has_package_json or has_react) else None,
            "backend_port": backend_port,
            "frontend_port": frontend_port,
        }

    @classmethod
    async def _launch_and_verify(
        cls,
        ticket_id: str,
        files: list[dict],
        project_root: str,
    ) -> dict | None:
        """
        Phase 7 launch loop:
          1. Commander installs deps (pip install / npm install)
          2. Commander starts the server(s) in background
          3. Voyager opens the app URL and screenshots it
          4. If errors → Darwin diagnoses → Forge fixes → Commander restarts → Voyager retests
        Returns the final Voyager result dict, or None if skipped.
        """
        import asyncio
        from app.agents.commander_agent import CommanderAgent
        from app.agents.voyager_agent import VoyagerAgent
        from app.services.ide_bus import ide_bus

        app = cls._detect_app_type(files)
        log.info("Darwin: launch_and_verify", project_root=project_root, app=app)

        ide_bus.emit({
            "agent":   "Darwin",
            "action":  "launching",
            "summary": f"Starting built app at {project_root}",
        })

        # ── Install dependencies ──────────────────────────────────────────────
        if app["has_backend"] and app["backend_dir"]:
            pip_result = await CommanderAgent.run(
                command="pip install -r requirements.txt -q",
                cwd=app["backend_dir"],
                caller="Darwin",
                reason="Install backend deps for created app",
                timeout=120,
                allow_external_cwd=True,
            )
            log.info("Darwin: pip install", ok=pip_result["ok"],
                     cwd=app["backend_dir"])

        if app["has_frontend"] and app["frontend_dir"]:
            npm_result = await CommanderAgent.run(
                command="npm install --silent",
                cwd=app["frontend_dir"],
                caller="Darwin",
                reason="Install frontend deps for created app",
                timeout=180,
                allow_external_cwd=True,
            )
            log.info("Darwin: npm install", ok=npm_result["ok"],
                     cwd=app["frontend_dir"])

        # ── Start backend server ──────────────────────────────────────────────
        if app["has_backend"] and app["backend_dir"] and app["backend_port"]:
            await CommanderAgent.run(
                command=f"start /B python -m uvicorn main:app --port {app['backend_port']}",
                cwd=app["backend_dir"],
                caller="Darwin",
                reason=f"Start backend server on port {app['backend_port']}",
                timeout=10,   # fire-and-forget; server runs in background
                allow_external_cwd=True,
            )
            await asyncio.sleep(3)  # give server time to bind

        # ── Start frontend dev server ─────────────────────────────────────────
        if app["has_frontend"] and app["frontend_dir"] and app["frontend_port"]:
            await CommanderAgent.run(
                command=f"start /B npm run dev",
                cwd=app["frontend_dir"],
                caller="Darwin",
                reason=f"Start frontend dev server on port {app['frontend_port']}",
                timeout=10,
                allow_external_cwd=True,
            )
            await asyncio.sleep(5)  # Vite takes a few seconds

        # ── Voyager tests the app ─────────────────────────────────────────────
        test_url = app.get("frontend_url") or app.get("backend_url")
        if not test_url:
            log.info("Darwin: no URL to test, skipping Voyager")
            return None

        await cls._upsert_ticket(ticket_id, {"status": "verifying"})
        ide_bus.emit({
            "agent":   "Darwin",
            "action":  "verifying",
            "summary": f"Asking Voyager to test {test_url}",
        })

        # Up to 3 Voyager → fix → retest cycles
        for attempt in range(1, 4):
            voyager = await VoyagerAgent.test_panel(
                panel="app",
                url=test_url,
                headless=True,
                timeout_ms=20_000,
            )
            log.info("Darwin: Voyager result",
                     attempt=attempt, ok=voyager["ok"],
                     errors=voyager["console_errors"])

            if voyager["ok"] or not voyager["console_errors"]:
                ide_bus.emit({
                    "agent":   "Darwin",
                    "action":  "result",
                    "summary": f"Voyager PASS — {test_url}",
                    "ok":      True,
                })
                return voyager

            # Errors found — try to fix
            if attempt < 3:
                error_text = "; ".join(voyager["console_errors"][:3])
                log.info("Darwin: Voyager found errors, attempting fix",
                         attempt=attempt, errors=error_text)
                ide_bus.emit({
                    "agent":   "Darwin",
                    "action":  "fixing",
                    "summary": f"Voyager found {len(voyager['console_errors'])} console error(s) — diagnosing",
                })
                # Oracle diagnoses the browser error
                from app.agents.oracle_agent import OracleAgent
                diagnosis = await OracleAgent.diagnose(
                    error_message=error_text,
                    traceback_str=f"Browser console errors at {test_url}:\n" + "\n".join(voyager["console_errors"]),
                )
                if diagnosis.get("old_string") and diagnosis.get("new_string") and diagnosis.get("file_path"):
                    from app.agents.forge_agent import ForgeAgent
                    fix = await ForgeAgent.apply_fix(
                        diagnosis["file_path"],
                        diagnosis["old_string"],
                        diagnosis["new_string"],
                    )
                    if fix["ok"]:
                        # Restart the relevant server
                        if app["has_frontend"] and app["frontend_dir"]:
                            await CommanderAgent.run(
                                command="start /B npm run dev",
                                cwd=app["frontend_dir"],
                                caller="Darwin",
                                reason="Restart frontend after fix",
                                timeout=10,
                                allow_external_cwd=True,
                            )
                        await asyncio.sleep(4)

        # Return last Voyager result even if not passing
        return voyager

    # ── Internal helpers ──────────────────────────────────────────────────────

    @classmethod
    def _extract_error_type(cls, error_message: str) -> str:
        """Pull the exception class name from an error string."""
        import re
        m = re.match(r"^(\w+(?:Error|Exception|Warning))", error_message.strip())
        return m.group(1) if m else "UnknownError"

    @classmethod
    async def _request_approval(cls, ticket_id, diagnosis, error_msg) -> bool:
        from app.services import approval_service
        approval_id, auto_approved = await approval_service.request_approval(
            agent       = "Darwin",
            action_type = "apply_code_fix",
            description = (
                f"Fix {diagnosis.get('file_path', 'unknown file')} — "
                f"{error_msg[:100]}"
            ),
            payload = {
                "ticket_id":  ticket_id,
                "file":       diagnosis.get("file_path"),
                "diagnosis":  diagnosis.get("diagnosis", "")[:300],
                "confidence": diagnosis.get("confidence", 0),
                "old_string": diagnosis.get("old_string", "")[:400],
                "new_string": diagnosis.get("new_string", "")[:400],
            },
        )
        if auto_approved:
            return True
        return await approval_service.wait_for_approval(approval_id, timeout=3600)

    @classmethod
    async def _request_create_approval(cls, ticket_id, description, files) -> bool:
        from app.services import approval_service
        approval_id, auto_approved = await approval_service.request_approval(
            agent       = "Darwin",
            action_type = "create_feature_files",
            description = f"Create {len(files)} new file(s): {description[:120]}",
            payload     = {
                "ticket_id": ticket_id,
                "files":     [f["path"] for f in files],
            },
        )
        if auto_approved:
            return True
        return await approval_service.wait_for_approval(approval_id, timeout=7200)

    @classmethod
    async def _get_ticket_field(cls, ticket_id: str, field: str) -> str | None:
        """Read a single text/jsonb column from an existing IT ticket row."""
        try:
            import psycopg2
            from app.core.config import settings as s
            conn = psycopg2.connect(
                host=s.POSTGRES_HOST, port=s.POSTGRES_PORT,
                user=s.POSTGRES_USER, password=s.POSTGRES_PASSWORD,
                dbname=s.POSTGRES_DB,
            )
            cur = conn.cursor()
            cur.execute(
                f"SELECT {field} FROM it_department_log WHERE ticket_id = %s LIMIT 1",
                (ticket_id,),
            )
            row = cur.fetchone()
            cur.close(); conn.close()
            if row and row[0] is not None:
                val = row[0]
                return val if isinstance(val, str) else json.dumps(val)
            return None
        except Exception as e:
            log.warning("Darwin: _get_ticket_field failed", field=field, error=str(e))
            return None

    @classmethod
    async def _upsert_ticket(cls, ticket_id: str, fields: dict) -> None:
        """Insert or update an it_department_log row."""
        try:
            import psycopg2
            from app.core.config import settings as s
            conn = psycopg2.connect(
                host=s.POSTGRES_HOST, port=s.POSTGRES_PORT,
                user=s.POSTGRES_USER, password=s.POSTGRES_PASSWORD,
                dbname=s.POSTGRES_DB,
            )
            cur = conn.cursor()

            # Try insert first, then update
            cur.execute(
                "SELECT id FROM it_department_log WHERE ticket_id = %s LIMIT 1",
                (ticket_id,),
            )
            existing = cur.fetchone()

            # Normalize affected_files: TEXT[] needs a Python list, not a JSON string
            if "affected_files" in fields:
                af = fields["affected_files"]
                if isinstance(af, str):
                    try:
                        parsed = json.loads(af)
                        fields = {**fields, "affected_files": parsed if isinstance(parsed, list) else []}
                    except Exception:
                        fields = {**fields, "affected_files": []}

            if not existing:
                cur.execute(
                    """INSERT INTO it_department_log
                       (ticket_id, type, status, trigger_text, traceback,
                        affected_files, diagnosis, proposed_changes, new_files,
                        test_results, user_approved, applied, resolution_note)
                       VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
                    (
                        ticket_id,
                        fields.get("type", "repair"),
                        fields.get("status", "open"),
                        fields.get("trigger_text", ""),
                        fields.get("traceback", ""),
                        fields.get("affected_files", []),
                        fields.get("diagnosis", "{}"),
                        fields.get("proposed_changes", "[]"),
                        fields.get("new_files", "[]"),
                        fields.get("test_results", "{}"),
                        fields.get("user_approved", False),
                        fields.get("applied", False),
                        fields.get("resolution_note", ""),
                    ),
                )
            else:
                set_parts = []
                vals      = []
                allowed   = {
                    "type", "status", "trigger_text", "traceback",
                    "affected_files", "diagnosis", "proposed_changes",
                    "new_files", "test_results", "user_approved",
                    "applied", "resolution_note", "resolved_at",
                }
                for k, v in fields.items():
                    if k in allowed:
                        set_parts.append(f"{k} = %s")
                        vals.append(v)
                if set_parts:
                    vals.append(ticket_id)
                    cur.execute(
                        f"UPDATE it_department_log SET {', '.join(set_parts)} WHERE ticket_id = %s",
                        vals,
                    )

            conn.commit()
            cur.close(); conn.close()
        except Exception as e:
            log.warning("Darwin: ticket upsert failed", error=str(e))
