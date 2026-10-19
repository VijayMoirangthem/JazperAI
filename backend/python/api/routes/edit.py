"""AI file editing with streamed hunks (aliased /api/v1/edit).

POST /stream  {path, instruction}  -> NDJSON: begin, hunk*, end   (also published on the `diff-stream` bus topic)
POST /apply   {path, content}      -> writes the accepted result (a .jasper-bak copy of the old file is kept)
GET  /file?path=                   -> current content
Paths must stay inside the project root and may not touch secrets, VCS data or dependencies.
"""
import json
import subprocess
from pathlib import Path
from uuid import uuid4

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from core.contracts import TraceContext
from core.diffstream import HunkStreamer
from core.eventbus import announce, bus
from core.llm.registry import get_router
from core.llm.types import LLMRequest, Usage

router = APIRouter()
ROOT = Path(__file__).resolve().parents[4]
BLOCKED = {".git", ".env", "node_modules", "storage", ".venv", "Project_References", "dist"}
MAX_BYTES = 400_000


def safe_path(rel: str) -> Path:
    p = (ROOT / rel).resolve()
    if ROOT not in p.parents or any(part in BLOCKED or part.startswith(".env") for part in p.relative_to(ROOT).parts):
        raise HTTPException(403, "path not allowed")
    return p


def _sha() -> str:
    try:
        return subprocess.run(["git", "rev-parse", "--short", "HEAD"], cwd=ROOT, capture_output=True, text=True, timeout=5).stdout.strip() or "0000000"
    except Exception:
        return "0000000"


class EditIn(BaseModel):
    path: str
    instruction: str


class ApplyIn(BaseModel):
    path: str
    content: str


@router.get("/file")
async def get_file(path: str):
    p = safe_path(path)
    if not p.is_file() or p.stat().st_size > MAX_BYTES:
        raise HTTPException(404, "not a readable text file")
    return {"path": path, "content": p.read_text(encoding="utf-8", errors="replace")}


@router.post("/apply")
async def apply(body: ApplyIn):
    p = safe_path(body.path)
    if p.exists():
        Path(str(p) + ".jasper-bak").write_text(p.read_text(encoding="utf-8", errors="replace"), encoding="utf-8")
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(body.content, encoding="utf-8")
    return {"path": body.path, "bytes": len(body.content.encode())}


@router.post("/stream")
async def stream(body: EditIn):
    p = safe_path(body.path)
    old_text = p.read_text(encoding="utf-8", errors="replace") if p.is_file() else ""
    if len(old_text) > MAX_BYTES:
        raise HTTPException(413, "file too large")
    old = old_text.split("\n")
    stream_id, branch, sha = str(uuid4()), f"agent-patch/edit-{uuid4().hex[:8]}", _sha()

    def event(op: str, idx: int, hunks=None, final=False) -> dict:
        ev = {"topic": "diff-stream", "stream_id": stream_id, "path": body.path, "branch": branch, "base_sha": sha if len(sha) >= 7 else "0000000",
              "op": op, "chunk_index": idx, "final": final,
              "hunks": [{"id": h.id, "old_start": h.old_start, "old_lines": h.old_len, "new_start": h.old_start,
                         "new_lines": len(h.new_lines), "patch": h.patch()} for h in (hunks or [])]}
        bus.publish(ev, TraceContext())
        return ev

    async def gen():
        r = await get_router()
        yield json.dumps(event("begin", 0)) + "\n"
        announce("forge", "working", bubble=f"Editing {body.path}")
        system = ("You edit one file. Output ONLY the complete new file content, no explanations, no markdown fences. "
                  "Preserve everything that should not change exactly, including whitespace.")
        prompt = f"File: {body.path}\n\n<<<FILE\n{old_text}\nFILE>>>\n\nInstruction: {body.instruction}"
        streamer, text, idx = HunkStreamer(old), "", 0
        try:
            async for item in r.stream(LLMRequest(system=system, messages=[{"role": "user", "content": prompt}], tier="standard", max_tokens=8000)):
                if isinstance(item, Usage):
                    continue
                text += item
                for h in streamer.feed(text):
                    idx += 1
                    yield json.dumps(event("hunk", idx, [h])) + "\n"
            if old_text.endswith("\n") and not text.endswith("\n"):
                text += "\n"  # models often drop the final newline
            for h in streamer.finish(text):
                idx += 1
                yield json.dumps(event("hunk", idx, [h])) + "\n"
            yield json.dumps(event("end", idx + 1, final=True)) + "\n"
            announce("forge", "idle")
        except Exception as e:
            announce("forge", "error", reason=str(e))
            yield json.dumps(event("abort", idx + 1, final=True)) + "\n"

    return StreamingResponse(gen(), media_type="application/x-ndjson")
