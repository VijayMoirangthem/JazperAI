"""Company feature flow (Plan V3 W4, spec section 3 Flow 1): Jasper -> group lead -> dev bot + QA bot -> lead report -> Jasper -> founder approval.

  1. The lead (e.g. ceo-baeit) turns the founder's request into requirements, files to touch and a test file.
  2. An agent-patch/* branch is made in a git worktree (the project checkout is never touched).
  3. Loop, at most 3 attempts (agents/devloop.py): the dev bot proposes SEARCH/REPLACE edits, the QA bot writes/updates the test, the tests run in a
     no-network Docker sandbox (node:20-alpine for Node/mocha projects, node_modules mounted read-only). Failures go back to dev and QA as feedback.
  4. Pass: commit with agent trailers; the lead writes a report (what changed, test log, risks, rollback). Fail x3: worktree rolled back, escalated.
  5. Merge into the project's branch only after a Tier-3 approval card (core.hitl, action git.merge_main). Discard removes branch and worktree.
Every step is written to the bot-to-bot comms log, so the whole exchange is visible in Chat and the Mind Map.
Pattern credit: aider (SEARCH/REPLACE edit blocks, repo map), crewAI (manager-led delegation), existing devloop (bounded LangGraph loop).
"""
import asyncio
import json
import re
import time
from pathlib import Path
from uuid import uuid4

from agents import comms, orgchart, workspaces
from agents.devloop import run_devloop
from core import finops, gitops, hitl
from core.llm.types import LLMRequest

ROOT = Path(__file__).resolve().parents[3]
WORKTREES = ROOT / "storage" / "worktrees"
RUNS: dict[str, dict] = {}
BLOCK = re.compile(r"FILE:\s*(?P<path>[^\n]+)\n<<<<<<< SEARCH\n(?P<search>.*?)\n?=======\n(?P<replace>.*?)\n?>>>>>>> REPLACE", re.S)
EDIT_RULES = ("Reply ONLY with edit blocks, nothing else, in exactly this format (repeat per change):\nFILE: relative/path.js\n<<<<<<< SEARCH\n"
              "exact existing lines to replace (EMPTY to create a new file)\n=======\nnew lines\n>>>>>>> REPLACE\n"
              "The SEARCH text must match the file exactly and appear once. Keep unrelated code untouched. Never touch .env, node_modules or .git.")
FULL_FORMAT = ("Reply ONLY with whole files, nothing else, in exactly this format (one block per file you change or create):\n=== FILE: relative/path.js ===\n<the COMPLETE new content of the file>\n=== END ===\n"
               "Keep everything unrelated to the task byte-for-byte identical. Never touch .env, node_modules or .git.")
FILES = re.compile(r"=== FILE:\s*(?P<path>[^\n=]+?)\s*===\n(?P<body>.*?)\n=== END ===", re.S)
MAX_FULL_LINES = 450
DENY = (".env", "node_modules/", ".git/", "package-lock.json")


def parse_blocks(text: str) -> list[tuple[str, str, str]]:
    return [(m["path"].strip().strip("`"), m["search"], m["replace"]) for m in BLOCK.finditer(text)]


def parse_files(text: str) -> list[tuple[str, str]]:
    out = []
    for m in FILES.finditer(text):
        body = m["body"]
        fence = re.match(r"^```[\w+-]*\n(.*)\n```$", body.strip(), re.S)  # models sometimes wrap the file in a code fence
        out.append((m["path"].strip().strip("`"), fence.group(1) if fence else body))
    return out


def apply_files(worktree: Path, files: list[tuple[str, str]], only: set[str] | None = None) -> list[str]:
    """Write whole files inside the worktree. `only` restricts which paths may be written (None = any allowed path)."""
    errs, root = [], worktree.resolve()
    for rel, body in files:
        p = (worktree / rel).resolve()
        if root not in p.parents or any(d in rel.replace("\\", "/") for d in DENY) or (only is not None and rel not in only):
            errs.append(f"{rel}: path not allowed")
            continue
        if not body.strip():
            errs.append(f"{rel}: empty file rejected")
            continue
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(body.rstrip("\n") + "\n", encoding="utf-8")
    return errs


def apply_blocks(worktree: Path, blocks: list[tuple[str, str, str]]) -> list[str]:
    """Apply edit blocks inside the worktree. Returns error strings (empty = all applied)."""
    errs, root = [], worktree.resolve()
    for rel, search, replace in blocks:
        p = (worktree / rel).resolve()
        if root not in p.parents or any(d in rel.replace("\\", "/") for d in DENY):
            errs.append(f"{rel}: path not allowed")
            continue
        if not search.strip():
            if p.exists() and p.read_text("utf-8", "replace").strip():
                errs.append(f"{rel}: exists; give a SEARCH block to change it")
                continue
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_text(replace + "\n", encoding="utf-8")
            continue
        if not p.exists():
            errs.append(f"{rel}: file not found")
            continue
        old = p.read_text("utf-8", "replace")
        n = old.count(search)
        if n != 1:
            errs.append(f"{rel}: SEARCH text matched {n} times (must be exactly once)")
            continue
        p.write_text(old.replace(search, replace, 1), encoding="utf-8")
    return errs


def _json(text: str) -> dict:
    m = re.search(r"\{.*\}", text, re.S)
    try:
        return json.loads(m.group(0)) if m else {}
    except Exception:
        return {}


async def _ask(slug: str, system_extra: str, prompt: str, router, max_tokens: int = 3500, tier: str = "standard") -> str:
    from api.routes.chat2 import _persona
    system, tier = _persona(slug)
    kw = {"system": f"{system}\n\n{system_extra}", "messages": [{"role": "user", "content": prompt}], "tier": tier, "max_tokens": max_tokens, "temperature": 0.2, **orgchart.llm_kwargs(slug)}
    with finops.attribute(slug, workspaces.GROUP_OF.get(slug)):
        res = await router.complete(LLMRequest(**kw))
    return res.text


async def _ask_files(slug: str, system_extra: str, prompt: str, router, max_tokens: int, tier: str, want=None) -> list[tuple[str, str]]:
    """Ask for whole-file blocks; if the reply has none (free models sometimes chat instead), ask once more with a firm correction."""
    for attempt in (1, 2):
        extra = "" if attempt == 1 else "\n\nYour previous reply contained no valid '=== FILE: path ===' ... '=== END ===' blocks. Reply again with ONLY those blocks."
        text = await _ask(slug, system_extra, prompt + extra, router, max_tokens, tier)
        files = [(p, b) for p, b in parse_files(text) if want is None or want(p)]
        if files:
            return files
    return []


def _profile(repo: Path, test_file: str) -> dict | None:
    """How to run tests for this repo. Node/mocha only for now (Baeit backend); others report 'no profile'."""
    pj = repo / "package.json"
    if pj.exists() and "mocha" in pj.read_text("utf-8", "replace") and (repo / "node_modules").is_dir():
        return {"cmd": ["npx", "mocha", "--timeout", "20000", test_file],
                "sandbox_opts": {"image": "node:20-alpine", "ro_mounts": ((str(repo / "node_modules"), "/work/node_modules"),), "mem": "1g", "cpus": "2"}}
    return None


def _tree(repo: Path, limit: int = 60) -> str:
    import subprocess
    out = subprocess.run(["git", "ls-files"], cwd=repo, capture_output=True, text=True).stdout.splitlines()
    top = sorted({f.split("/")[0] + ("/" if "/" in f else "") for f in out})
    return "\n".join(top[:limit])


def _context_files(wt: Path, hints: list[str], task: str, cap_files: int = 2, cap_chars: int = 14000) -> str:
    import subprocess
    files = subprocess.run(["git", "ls-files"], cwd=wt, capture_output=True, text=True).stdout.splitlines()
    words = [w for w in re.split(r"[^a-z0-9]+", task.lower()) if len(w) > 3]
    chosen = [f for f in files if any(h and (f == h or f.endswith(h) or h in f) for h in hints)]
    if len(chosen) < cap_files:
        scored = sorted(((sum(w in f.lower() for w in words), f) for f in files if f.endswith((".js", ".ts", ".py", ".json")) and not any(d in f for d in DENY)), reverse=True)
        chosen += [f for sc, f in scored if sc > 0 and f not in chosen]
    parts = []
    for f in chosen[:cap_files]:
        try:
            parts.append(f"=== {f} ===\n{(wt / f).read_text('utf-8', 'replace')[:cap_chars]}")
        except OSError:
            pass
    return "\n\n".join(parts)


def _log(run: dict, who: str, text: str) -> None:
    run["events"].append({"t": time.time(), "who": who, "text": text[:400]})


async def _execute(run: dict) -> None:
    from core.llm.registry import get_router
    repo, lead = Path(run["repo"]), run["lead"]
    try:
        router = await get_router()
        run["status"] = "planning"
        await comms.log("jasper", lead, "ask", f"Feature request: {run['task']}")
        plan_txt = await _ask(lead, "You are the group lead. Plan the work for your team.",
                              f"Founder request: {run['task']}\n\nProject files (top level):\n{_tree(repo)}\n\nReply with JSON only: "
                              '{"summary": "...", "requirements": ["3-6 testable requirements"], "files_hint": ["paths likely to change"], '
                              '"test_file": "tests/<name>.test.js", "risks": ["..."]}', router, 1200)
        plan = _json(plan_txt)
        test_file = str(plan.get("test_file") or "tests/feature.test.js")
        if not test_file.startswith("tests/") or ".." in test_file:
            test_file = "tests/feature.test.js"
        run["plan"] = {"summary": plan.get("summary", ""), "requirements": plan.get("requirements", []), "files_hint": plan.get("files_hint", []), "risks": plan.get("risks", []), "test_file": test_file}
        await comms.log(lead, "jasper", "reply", f"Plan: {run['plan']['summary']} | requirements: {'; '.join(map(str, run['plan']['requirements']))[:300]}")
        _log(run, lead, "plan: " + str(run["plan"]["summary"]))
        prof = _profile(repo, test_file)
        if not prof:
            raise RuntimeError("no test profile for this repo (needs a Node/mocha project with node_modules installed)")
        dev = next((b for b in workspaces.GROUP_OF if workspaces.GROUP_OF[b] == run["group"] and any(k in b for k in ("backend", "dev"))), lead)
        qa = next((b for b in workspaces.GROUP_OF if workspaces.GROUP_OF[b] == run["group"] and ("qa" in b)), lead)
        run.update(dev=dev, qa=qa)

        async def implement(wt: Path, attempt: int, feedback: str) -> None:
            run.update(status="implementing", attempt=attempt)
            ctx = _context_files(wt, run["plan"]["files_hint"], run["task"])
            req = "\n".join(f"- {r}" for r in run["plan"]["requirements"])
            fb = f"\n\nThe previous attempt FAILED. Test output:\n{feedback[-1800:]}\nFix the code (or the test if it is wrong)." if feedback else ""
            if run.get("last_errors"):
                fb += f"\n\nProblems applying your last edits: {'; '.join(run['last_errors'])[:600]}"
            await comms.log(lead, dev, "ask", f"Implement (attempt {attempt}): {run['task'][:200]}")
            files = await _ask_files(dev, FULL_FORMAT + f"\nDo NOT change or create {test_file}; the QA bot owns it.", f"Task: {run['task']}\nRequirements:\n{req}\n\nRelevant files (full content):\n{ctx}{fb}", router, 5000, "frontier", lambda p: p != test_file)
            errs = apply_files(wt, files) if files else ["no file blocks found in the reply"]
            run["last_errors"] = errs
            await comms.log(dev, lead, "reply", f"{len(files)} file(s) written: {', '.join(p for p, _ in files)[:160]}" + (f"; problems: {'; '.join(errs)[:200]}" if errs else ""))
            _log(run, dev, f"files: {[p for p, _ in files]}" + (f", errors: {errs}" if errs else ""))
            diff = (await gitops.git(wt, "diff"))[:5000]
            await comms.log(lead, qa, "ask", f"Write/adjust {test_file} for: {run['task'][:160]}")
            tfiles = await _ask_files(qa, FULL_FORMAT + f"\nWrite ONLY the mocha test file {test_file} (CommonJS, require('assert'), no database, no network, no server start). "
                              "Test the new behaviour through the modules directly (for example require the model file shown in the diff and use mongoose validateSync / virtuals). "
                              "Use the exact export shape of the module shown in the diff.",
                              f"Task: {run['task']}\nRequirements:\n{req}\n\nChanges so far (git diff):\n{diff}\n\nExisting test file (if any):\n"
                              f"{(wt / test_file).read_text('utf-8', 'replace')[:4000] if (wt / test_file).exists() else '(none)'}{fb}", router, 3000, "frontier", lambda p: p == test_file)
            terrs = apply_files(wt, tfiles, {test_file}) if tfiles else [f"no block for {test_file} in the reply"]
            run["last_errors"] = (run.get("last_errors") or []) + terrs
            await comms.log(qa, lead, "reply", f"test file updated" + (f"; problems: {'; '.join(terrs)[:200]}" if terrs else ""))
            _log(run, qa, "tests: " + (f"errors {terrs}" if terrs else "written"))

        run["status"] = "implementing"
        out = await run_devloop(repo, WORKTREES, run["task"], prof["cmd"], implement, workdir="", sandbox=True, sandbox_opts=prof["sandbox_opts"], agent=dev, test_timeout=300)
        passed = out.get("passed") is True
        run.update(branch=out.get("branch"), base=out.get("base"), history=out.get("history", []), worktree_path=out.get("worktree"), commit=out.get("commit"))
        if passed:
            diff = (await gitops.diff(Path(out["worktree"]), out["base"]))[:30000]
            run["diff"] = diff
            report = await _ask(lead, "Write the completion report for the founder: 6-10 lines, plain language.",
                                f"Task: {run['task']}\nAttempts: {len(run['history'])}\nTests: passed in the Docker sandbox ({' '.join(prof['cmd'])})\nDiff:\n{diff[:6000]}\n\n"
                                "Include: what changed (files), how it was verified, risks, and how to roll back (git branch delete).", router, 900)
            run.update(report=report, status="verified")
            await comms.log(lead, "jasper", "reply", "Done and verified: " + report[:300])
            from core import push
            await push.send("Feature ready", "A feature run passed its tests", {"type": "feature", "id": run["id"], "slug": lead})
        else:
            run.update(status="failed", report=f"Gave up after {len(run['history'])} attempts; the worktree was rolled back. Last output: {out.get('feedback', '')[-1800:]}")
            await comms.log(lead, "jasper", "reply", "Could not complete the feature safely; rolled back and escalated.")
            from core import alerts
            await alerts.incident("feature_flow", "tests failed after 3 attempts, rolled back: " + run["task"][:120], {"run": run["id"]})
    except Exception as e:
        run.update(status="error", error=str(e)[:300])
        await comms.log(lead, "jasper", "reply", "error: " + str(e)[:200])


def public(run: dict) -> dict:
    return {k: v for k, v in run.items() if k not in ("task_handle", "merge_handle", "worktree_path", "diff")} | {"diff_preview": (run.get("diff") or "")[:4000]}


async def start(group: str, task: str, repo: str, requester: str = "jasper") -> dict:
    lead = {"baeit": "ceo-baeit", "boardmint": "lead-boardmint", "create_origins": "ceo-create-origins"}.get(group)
    rp = Path(repo).resolve()
    if not lead:
        raise ValueError("group must be baeit, boardmint or create_origins")
    if not (rp / ".git").exists():
        raise ValueError("repo is not a git repository (the flow needs git for branch isolation)")
    if not any(rp == Path(w["path"]).resolve() or Path(w["path"]).resolve() in rp.parents for w in workspaces._cache.get(group, [])):
        raise ValueError("repo is outside the group's workspace folders")
    rid = uuid4().hex[:10]
    run = {"id": rid, "group": group, "lead": lead, "task": task[:2000], "repo": str(rp), "status": "starting", "attempt": 0, "events": [], "requester": requester, "merge": None}
    RUNS[rid] = run
    run["task_handle"] = asyncio.create_task(_execute(run))
    return public(run)


async def merge(rid: str) -> None:
    run = RUNS[rid]
    run["merge"] = "awaiting-approval"
    try:
        ok = await hitl.gate("git.merge_main", f"Merge {run['branch']} into {run['repo']}: {run['task'][:200]}. Tests passed in the sandbox. Report: {run.get('report', '')[:300]}", run["lead"], ttl_s=900)
        rid_h = hitl.last_request_id()
        if not ok:
            run["merge"] = "denied"
            return
        run["merge_sha"] = await gitops.merge_to_main(Path(run["repo"]), run["branch"], str(rid_h))
        run["merge"] = "merged"
    except Exception as e:
        run.update(merge="error", error=str(e)[:300])


async def discard(rid: str) -> None:
    run = RUNS.pop(rid)
    if run.get("branch") and run.get("worktree_path"):
        await gitops.remove(Path(run["repo"]), Path(run["worktree_path"]), run["branch"])
