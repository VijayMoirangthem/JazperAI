import ast
import subprocess
import sys
import textwrap
from pathlib import Path

import pytest

from agents import ast_repair
from agents.ast_repair import RepairRejected, enclosing_function, make_repair_implementer, parse_frames, validate_and_apply
from agents.devloop import run_devloop
from core import repomap
from core.llm.types import LLMResult, Usage
from memory.db import aio

# ── five seeded bugs: (module, buggy source, test, correct function, failing function name) ──
BUGS = {
    "add": ("mathx.py", "def add(a, b):\n    return a - b\n", "from mathx import add\n\ndef test_add():\n    assert add(2, 3) == 5\n", "def add(a, b):\n    return a + b"),
    "slug": ("strx.py", "def slugify(s):\n    return s.strip().replace(' ', '-').upper()\n",
             "from strx import slugify\n\ndef test_slug():\n    assert slugify(' Hello World ') == 'hello-world'\n", "def slugify(s):\n    return s.strip().replace(' ', '-').lower()"),
    "first": ("listx.py", "def first(items):\n    return items[1]\n", "from listx import first\n\ndef test_first():\n    assert first([7, 8]) == 7\n", "def first(items):\n    return items[0]"),
    "method": ("cls.py", "class Counter:\n    def __init__(self):\n        self.n = 0\n\n    def inc(self):\n        self.n -= 1\n        return self.n\n",
               "from cls import Counter\n\ndef test_inc():\n    c = Counter()\n    c.inc()\n    assert c.inc() == 2\n", "def inc(self):\n    self.n += 1\n    return self.n"),
    "even": ("cond.py", "def is_even(n):\n    return n % 2 == 1\n", "from cond import is_even\n\ndef test_even():\n    assert is_even(4) and not is_even(3)\n", "def is_even(n):\n    return n % 2 == 0"),
}


class RuleRouter:
    """Stands in for the model: returns the correct function for whichever function the prompt asks to fix."""

    def __init__(self, fixes):
        self.fixes, self.calls = fixes, 0

    async def complete(self, req):
        self.calls += 1
        prompt = req.messages[0]["content"]
        for name, fn in self.fixes.items():
            if f"def {name}(" in prompt.split("Function to fix in")[-1]:
                return LLMResult(text=fn, usage=Usage(provider="rule", model="rule"))
        return LLMResult(text="def nothing():\n    pass", usage=Usage(provider="rule", model="rule"))


def sh(cwd, *a):
    return subprocess.run(a, cwd=cwd, capture_output=True, text=True, check=True).stdout.strip()


def make_repo(tmp_path, key):
    r = tmp_path / f"repo-{key}"
    r.mkdir()
    mod, buggy, test, _ = BUGS[key]
    (r / mod).write_text(buggy)
    (r / f"test_{mod}").write_text(test)
    sh(r, "git", "init", "-q", "-b", "main"); sh(r, "git", "config", "user.email", "t@t"); sh(r, "git", "config", "user.name", "t")
    sh(r, "git", "add", "-A"); sh(r, "git", "commit", "-qm", "init")
    return r


async def run_tests(wt: Path):
    p = subprocess.run([sys.executable, "-m", "pytest", "-q", "-x", "-p", "no:cacheprovider", "--tb=short"], cwd=wt, capture_output=True, text=True)
    return p.returncode, p.stdout + p.stderr


# ── unit tests ──
def test_parse_frames_from_pytest_short_traceback(tmp_path):
    (tmp_path / "mathx.py").write_text("def add(a, b):\n    return a - b\n")
    out = "test_mathx.py:4: in test_add\n    assert add(2, 3) == 5\nmathx.py:2: in add\n    return a - b\nE   assert -1 == 5\n"
    frames = parse_frames(out, tmp_path)
    assert frames == [("mathx.py", 2, "add")]  # the test frame is dropped, the faulty function is found


def test_validation_accepts_only_a_clean_single_function_replacement():
    src = "X = 1\n\nclass C:\n    def m(self):\n        return 1\n\ndef f():\n    return 1\n\ndef g():\n    return 2\n"
    target = enclosing_function(src, 8)
    new = validate_and_apply(src, target, "def f():\n    return 42")
    assert "return 42" in new and "def g():\n    return 2" in new and ast.parse(new)
    for bad in ["def other():\n    return 1", "def f():\n    return 1\ndef extra():\n    pass", "def f(:\n  x", "X = 2"]:
        with pytest.raises(RepairRejected):
            validate_and_apply(src, target, bad)
    method = enclosing_function(src, 5)
    out = validate_and_apply(src, method, "def m(self):\n    return 'new'")
    assert "    def m(self):\n        return 'new'" in out  # indentation preserved


def test_repo_map_ranks_widely_used_modules_and_follows_focus(tmp_path):
    (tmp_path / "core.py").write_text("def helper():\n    return 1\n\nclass Base:\n    pass\n")
    for i in range(4):
        (tmp_path / f"user{i}.py").write_text(f"from core import helper\n\ndef use{i}():\n    return helper()\n")
    (tmp_path / "lonely.py").write_text("def alone():\n    return 0\n")
    files = repomap.scan(tmp_path)
    ranked = [p for p, _ in repomap.rank(files)]
    assert ranked[0] == "core.py"
    focused = [p for p, _ in repomap.rank(files, focus={"lonely.py"})]
    assert focused.index("lonely.py") < ranked.index("lonely.py")
    text = repomap.render(files, repomap.rank(files), 400)
    assert "core.py" in text and "def helper" in text and len(text) <= 400


# ── end to end through the dev loop ──
@pytest.mark.db
async def test_five_seeded_bugs_repaired_within_three_attempts_with_no_unrelated_edits(tmp_path):
    try:
        await aio.fetch("SELECT 1")
    except Exception:
        pytest.skip("postgres unavailable")
    fixed = 0
    for key in BUGS:
        repo = make_repo(tmp_path, key)
        mod = BUGS[key][0]
        router = RuleRouter({BUGS[key][3].split("(")[0].replace("def ", ""): BUGS[key][3]})
        impl = make_repair_implementer(router, run_tests)
        out = await run_devloop(repo, tmp_path / f"wt-{key}", f"repair {key}", [sys.executable, "-m", "pytest", "-q", "-x", "-p", "no:cacheprovider", "--tb=short"], impl)
        if out["passed"] and out["attempt"] <= 3:
            fixed += 1
            changed = sh(out["worktree"], "git", "diff", "--name-only", out["base"], "HEAD").split()
            assert changed == [mod], changed  # only the faulty module was touched
    assert fixed == 5
    await aio.close_pool()


async def test_unrelated_or_invalid_model_output_never_reaches_the_file(tmp_path):
    repo = make_repo(tmp_path, "add")
    original = (repo / "mathx.py").read_text()

    class Rogue:
        async def complete(self, req):
            return LLMResult(text="def add(a, b):\n    return a + b\n\ndef backdoor():\n    return 'pwned'", usage=Usage(provider="r", model="r"))

    _, out = await run_tests(repo)
    with pytest.raises(RepairRejected):
        await ast_repair.repair_once(repo, out, Rogue())
    assert (repo / "mathx.py").read_text() == original  # untouched


@pytest.mark.skipif(not __import__("os").getenv("RUN_LIVE"), reason="live model call; set RUN_LIVE=1")
@pytest.mark.db
async def test_live_model_repair_rate_on_seeded_bugs(tmp_path):
    from core.llm.registry import get_router
    router = await get_router()
    fixed, tokens = 0, 0
    for key in BUGS:
        repo = make_repo(tmp_path, key)
        impl = make_repair_implementer(router, run_tests)
        out = await run_devloop(repo, tmp_path / f"wt-{key}", f"repair {key}", [sys.executable, "-m", "pytest", "-q", "-x", "-p", "no:cacheprovider", "--tb=short"], impl)
        ok = bool(out.get("passed"))
        fixed += ok
        print(f"LIVE {key}: {'fixed' if ok else 'FAILED'} in {out.get('attempt')} attempt(s)")
    print(f"LIVE repair rate: {fixed}/5")
    from core import finops
    s = await finops.summary()
    print("LIVE tokens today (all agents):", s["today"]["input_tokens"] + s["today"]["output_tokens"])
    await aio.close_pool()
    assert fixed >= 4
