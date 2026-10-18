"""
Forge — Code Writer Agent (IT Department, Stage 1 + 2).

Forge applies targeted fixes to existing files and creates new files.
It NEVER overwrites a file wholesale — only exact string replacements (Stage 1)
or brand-new file creation (Stage 2 Self-Create).

Darwin calls Forge after Oracle diagnoses and the user approves.
Shield tests the result after Forge applies changes.
"""

import structlog
from app.tools.filesystem_tool import (
    write_codebase_diff,
    create_codebase_file,
    backup_file,
    restore_backup,
    FilesystemError,
)

log = structlog.get_logger()


def _emit(action: str, file_path: str, **extra) -> None:
    try:
        from app.services.ide_bus import ide_bus
        ide_bus.emit({"agent": "Forge", "action": action, "file": file_path, **extra})
    except Exception:
        pass


class ForgeAgent:

    @classmethod
    async def apply_fix(
        cls,
        file_path:  str,
        old_string: str,
        new_string: str,
    ) -> dict:
        """
        Apply a targeted string replacement to a file.
        Backs up first so Shield can trigger restore on failure.

        Returns:
          {"ok": True, "bak_path": "..."}  on success
          {"ok": False, "error": "..."}    on failure
        """
        _emit("editing", file_path,
              old=old_string[:100], new=new_string[:100])
        try:
            bak = backup_file(file_path)
            write_codebase_diff(file_path, old_string, new_string, auto_backup=False)
            log.info("Forge: fix applied", path=file_path)
            _emit("done", file_path)
            return {"ok": True, "bak_path": bak}
        except FilesystemError as e:
            log.error("Forge: apply_fix failed", path=file_path, error=str(e))
            _emit("error", file_path, error=str(e))
            return {"ok": False, "error": str(e), "bak_path": None}

    @classmethod
    async def create_file(cls, file_path: str, content: str) -> dict:
        """
        Create a new file as part of the Self-Create workflow.

        Returns:
          {"ok": True}           on success
          {"ok": False, "error"} on failure
        """
        _emit("creating", file_path)
        try:
            create_codebase_file(file_path, content, overwrite=False)
            log.info("Forge: new file created", path=file_path)
            import asyncio as _asyncio
            _asyncio.create_task(cls._scribe_tests(file_path, content))
            _emit("done", file_path)
            return {"ok": True}
        except FilesystemError as e:
            log.error("Forge: create_file failed", path=file_path, error=str(e))
            _emit("error", file_path, error=str(e))
            return {"ok": False, "error": str(e)}

    @classmethod
    async def _scribe_tests(cls, file_path: str, content: str) -> None:
        try:
            from app.agents.scribe_agent import ScribeAgent
            result = await ScribeAgent.generate_tests(file_path, content)
            if result["ok"] and not result.get("skipped"):
                log.info("Forge: Scribe generated tests", test_path=result["test_path"])
            elif not result["ok"]:
                log.warning("Forge: Scribe test generation failed", error=result.get("error"))
        except Exception as e:
            log.warning("Forge: Scribe task error", error=str(e))

    @classmethod
    async def restore(cls, bak_path: str) -> dict:
        """
        Roll back to the backup made before apply_fix.
        Darwin calls this when Shield reports test failures.
        """
        try:
            ok = restore_backup(bak_path)
            if ok:
                log.info("Forge: restored from backup", bak=bak_path)
                return {"ok": True}
            return {"ok": False, "error": "Backup file not found"}
        except Exception as e:
            log.error("Forge: restore failed", error=str(e))
            return {"ok": False, "error": str(e)}
