"""AST-constrained code repair: failing test output -> the exact failing function -> a replacement for ONLY that function -> AST validation
(parses, same name, nothing else in the file changed) -> apply. Plugs into the dev loop as its `implement` step (max 3 attempts there).
The model never rewrites whole files, so unrelated edits are impossible by construction and are also rejected by validation."""
import ast
import re
from pathlib import Path

from core import finops, repomap
from core.llm.types import LLMRequest

SYSTEM = ("You fix one failing Python function. Reply with ONLY the complete corrected function definition (same name and signature, "
          "decorators included if any), no explanations and no markdown fences.")
_FRAME = re.compile(r'File "([^"]+)", line (\d+), in (\w+)|^([\w./\\-]+\.py):(\d+): in (\w+)', re.M)
_FENCE = re.compile(r"^```[\w+-]*\n(.*?)\n```\s*$", re.S)


class RepairRejected(Exception):
    pass


def parse_frames(output: str, root: Path) -> list[tuple[str, int, str]]:
    """Traceback frames (file relative to root, line, function), deepest last; frames outside the repo or in test files are dropped."""
    frames = []
    for m in _FRAME.finditer(output):
        f, line, fn = (m.group(1), m.group(2), m.group(3)) if m.group(1) else (m.group(4), m.group(5), m.group(6))
        try:
            p = Path(f)
            rel = (p.resolve().relative_to(root.resolve()) if p.is_absolute() else Path(f)).as_posix()
        except ValueError:
            continue
        if (root / rel).exists() and not Path(rel).name.startswith("test_") and "/test" not in rel and fn != "<module>":
            frames.append((rel, int(line), fn))
    return frames


def locate_by_calls(output: str, root: Path) -> tuple[str, int, str] | None:
    """A wrong return value never appears in the traceback (only the test frame does), so localise by what the failing statement calls:
    the first called name that a project (non-test) file defines is the suspect."""
    defs: dict[str, tuple[str, int]] = {}
    for rel, info in repomap.scan(root).items():
        if Path(rel).name.startswith("test_") or "/test" in rel:
            continue
        for name, lineno, _ in info.defs:
            defs.setdefault(name, (rel, lineno))
    for m in reversed(list(_FRAME.finditer(output))):
        f, line = (m.group(1), int(m.group(2))) if m.group(1) else (m.group(4), int(m.group(5)))
        p = Path(f)
        try:
            rel = (p.resolve().relative_to(root.resolve()) if p.is_absolute() else p).as_posix()
        except ValueError:
            continue
        tf = root / rel
        if not tf.exists() or not Path(rel).name.startswith("test_"):
            continue
        tree = ast.parse(tf.read_text(encoding="utf-8"))
        stmts = [n for n in ast.walk(tree) if isinstance(n, ast.stmt) and not isinstance(n, (ast.FunctionDef, ast.ClassDef)) and n.lineno <= line <= (n.end_lineno or n.lineno)]
        if not stmts:
            continue
        stmt = min(stmts, key=lambda n: (n.end_lineno or n.lineno) - n.lineno)
        names = [(c.func.id if isinstance(c.func, ast.Name) else c.func.attr) for c in ast.walk(stmt) if isinstance(c, ast.Call) and isinstance(c.func, (ast.Name, ast.Attribute))]
        for n in names:
            if n in defs:
                return defs[n][0], defs[n][1], n
    return None


def enclosing_function(source: str, line: int) -> ast.AST | None:
    best = None
    for node in ast.walk(ast.parse(source)):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.lineno <= line <= (node.end_lineno or node.lineno):
            if best is None or node.lineno >= best.lineno:
                best = node
    return best


def _qualname(tree: ast.Module, lineno: int) -> str | None:
    def walk(node, stack):
        for child in ast.iter_child_nodes(node):
            if isinstance(child, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
                if isinstance(child, (ast.FunctionDef, ast.AsyncFunctionDef)) and child.lineno == lineno:
                    return ".".join(stack + [child.name])
                found = walk(child, stack + [child.name])
                if found:
                    return found
            else:
                found = walk(child, stack)
                if found:
                    return found
        return None
    return walk(tree, [])


def _skeleton(tree: ast.Module, qual: str) -> str:
    """Dump of the whole module with the function `qual` blanked out: equal skeletons mean only that function changed."""
    class T(ast.NodeTransformer):
        def __init__(self):
            self.stack: list[str] = []

        def _visit(self, node):
            q = ".".join(self.stack + [node.name])
            if q == qual and not isinstance(node, ast.ClassDef):
                return ast.Pass()
            self.stack.append(node.name)
            self.generic_visit(node)
            self.stack.pop()
            return node

        visit_FunctionDef = visit_AsyncFunctionDef = visit_ClassDef = _visit

    return ast.dump(T().visit(ast.parse(ast.unparse(tree))))


def validate_and_apply(source: str, target: ast.AST, new_func: str) -> str:
    """Return the new file text, or raise RepairRejected. Only `target` may change."""
    try:
        new_tree = ast.parse(new_func)
    except SyntaxError as e:
        raise RepairRejected(f"replacement does not parse: {e.msg}")
    if len(new_tree.body) != 1 or not isinstance(new_tree.body[0], (ast.FunctionDef, ast.AsyncFunctionDef)):
        raise RepairRejected("replacement must be exactly one function definition")
    if new_tree.body[0].name != target.name:
        raise RepairRejected("replacement changed the function name")
    lines = source.splitlines(keepends=True)
    start = (target.decorator_list[0].lineno if target.decorator_list else target.lineno) - 1
    indent = re.match(r"\s*", lines[start]).group(0)
    body = "".join((indent + l if l.strip() else l) for l in new_func.rstrip("\n").splitlines(keepends=True)) + "\n"
    new_source = "".join(lines[:start]) + body + "".join(lines[target.end_lineno:])
    try:
        before, after = ast.parse(source), ast.parse(new_source)
    except SyntaxError as e:
        raise RepairRejected(f"file no longer parses: {e.msg}")
    qual = _qualname(before, target.lineno)
    if qual is None or _skeleton(before, qual) != _skeleton(after, qual):
        raise RepairRejected("edit touched code outside the failing function")
    return new_source


async def repair_once(worktree: Path, test_output: str, router, agent: str = "forge") -> str:
    """Apply one constrained repair; returns a short description. Raises RepairRejected when nothing valid could be applied."""
    frames = parse_frames(test_output, worktree)
    suspect = frames[-1] if frames else locate_by_calls(test_output, worktree)  # deepest project frame, else what the failing assertion calls
    if suspect is None:
        raise RepairRejected("could not localise the fault from the test output")
    rel, line, fn = suspect
    path = worktree / rel
    source = path.read_text(encoding="utf-8")
    target = enclosing_function(source, line)
    if target is None:
        raise RepairRejected(f"{rel}:{line} is not inside a function")
    func_src = "".join(source.splitlines(keepends=True)[target.lineno - 1:target.end_lineno])
    prompt = (f"Repo map (most relevant files first):\n{repomap.repo_map(worktree, focus={rel}, budget_chars=1800)}\n"
              f"Failing test output:\n{test_output[-1500:]}\n\nFunction to fix in {rel}:\n{func_src}")
    with finops.attribute(agent):
        res = await router.complete(LLMRequest(system=SYSTEM, messages=[{"role": "user", "content": prompt}], tier="standard", max_tokens=1500))
    text = res.text.strip()
    m = _FENCE.match(text)
    new_func = (m.group(1) if m else text)
    new_func = re.sub(r"^(?=\S)", "", new_func)
    path.write_text(validate_and_apply(source, target, _dedent(new_func)), encoding="utf-8")
    return f"{rel}::{target.name}"


def _dedent(s: str) -> str:
    import textwrap
    return textwrap.dedent(s)


def make_repair_implementer(router, run_tests, agent: str = "forge"):
    """`run_tests(worktree) -> (exit_code, output)`: the first attempt measures the failure itself, later attempts reuse the loop's feedback."""
    async def implement(worktree: Path, attempt: int, feedback: str) -> None:
        output = feedback
        if not output:
            code, output = await run_tests(worktree)
            if code == 0:
                return  # nothing to repair
        await repair_once(worktree, output, router, agent)
    return implement
