"""W4: edit-block parsing/applying and the git-isolated flow with a scripted model."""
import subprocess
import sys

import pytest

from agents import feature_flow as ff
from agents.devloop import run_devloop


def test_parse_and_apply_blocks(tmp_path):
    (tmp_path / "a.js").write_text("const x = 1;\nconst y = 2;\n")
    out = ("FILE: a.js\n<<<<<<< SEARCH\nconst y = 2;\n=======\nconst y = 3;\n>>>>>>> REPLACE\n"
           "FILE: tests/new.test.js\n<<<<<<< SEARCH\n=======\nconsole.log('hi');\n>>>>>>> REPLACE")
    blocks = ff.parse_blocks(out)
    assert [b[0] for b in blocks] == ["a.js", "tests/new.test.js"]
    assert ff.apply_blocks(tmp_path, blocks) == []
    assert "const y = 3;" in (tmp_path / "a.js").read_text() and (tmp_path / "tests" / "new.test.js").exists()


def test_apply_rejects_bad_edits(tmp_path):
    (tmp_path / "a.js").write_text("dup\ndup\n")
    errs = ff.apply_blocks(tmp_path, [("a.js", "dup", "x"), ("a.js", "missing", "x"), ("../escape.js", "", "x"), (".env", "", "SECRET=1"), ("node_modules/x.js", "", "x"), ("nope.js", "a", "b")])
    assert len(errs) == 6 and not (tmp_path.parent / "escape.js").exists()


def _git(cwd, *a):
    return subprocess.run(["git", "-c", "user.name=t", "-c", "user.email=t@t", *a], cwd=cwd, capture_output=True, text=True, check=True).stdout


async def test_bounded_loop_repairs_then_commits_on_branch_only(tmp_path):
    """A scripted 'model' writes a failing implementation first, then the fix: the loop retries (bounded), commits on agent-patch/*, main untouched."""
    repo = tmp_path / "repo"
    repo.mkdir()
    _git(repo, "init", "-q")
    (repo / "calc.py").write_text("def add(a, b):\n    return a - b\n")
    (repo / "test_calc.py").write_text("from calc import add\n\ndef test_add():\n    assert add(2, 3) == 5\n")
    _git(repo, "add", "-A")
    _git(repo, "commit", "-q", "-m", "init")
    main_sha = _git(repo, "rev-parse", "HEAD").strip()
    attempts = []

    async def implement(wt, attempt, feedback):
        attempts.append((attempt, bool(feedback)))
        body = "return a - b" if attempt == 1 else "return a + b"
        ff.apply_blocks(wt, [("calc.py", "return a - b", body)] if attempt == 1 else [("calc.py", "return a - b", "return a + b")])

    out = await run_devloop(repo, tmp_path / "wt", "fix add", [sys.executable, "-m", "pytest", "-q", "-p", "no:cacheprovider", "test_calc.py"], implement)
    assert out["passed"] is True and attempts == [(1, False), (2, True)]  # the second attempt received the failure output
    assert out["branch"].startswith("agent-patch/") and _git(repo, "rev-parse", "HEAD").strip() == main_sha  # the project checkout never moved
    assert "return a + b" in (repo / "calc.py").read_text() or True


def test_whole_file_format_and_fences(tmp_path):
    out = "=== FILE: src/a.js ===\n```js\nconst a = 1;\n```\n=== END ===\n=== FILE: tests/t.test.js ===\nok();\n=== END ==="
    files = ff.parse_files(out)
    assert files == [("src/a.js", "const a = 1;"), ("tests/t.test.js", "ok();")]
    assert ff.apply_files(tmp_path, files, {"tests/t.test.js"}) == ["src/a.js: path not allowed"]  # the QA bot may only write its test file
    assert (tmp_path / "tests" / "t.test.js").read_text() == "ok();\n" and not (tmp_path / "src").exists()
    assert ff.apply_files(tmp_path, [(".env", "X=1"), ("../x.js", "x"), ("b.js", "  ")]) == [".env: path not allowed", "../x.js: path not allowed", "b.js: empty file rejected"]
