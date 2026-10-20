"""Flow 1 acceptance (Plan V3 W4): the full pipeline on a throwaway clone of the Baeit backend with a SCRIPTED developer, so the result does not depend
on model quality. Proves: agent-patch branch in a worktree, Node tests in the no-network Docker sandbox, bounded repair loop (first attempt is
deliberately wrong, the second fixes it), commit with agent trailers, diff, a Tier-3 merge request that is NOT approved (default-deny) and leaves the
project untouched, then clean-up.

    cd backend\\python ; ..\\.venv\\Scripts\\python.exe ..\\..\\scripts\\flow1_acceptance.py
"""
import asyncio
import json
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "backend" / "python"))
CLONE = ROOT / "storage" / "demo" / "baeit-backend"
MODEL = "src/modules/restaurants/models/RestaurantsList.js"
TEST = "tests/discountEndsAt.test.js"

FIELD = """        discountEndsAt: {
            type: Date,
            required: false,
            validate: {
                validator: (v) => v == null || v.getTime() > Date.now(),
                message: 'discountEndsAt must be in the future'
            }
        },
"""
BROKEN_FIELD = FIELD.replace("v.getTime() > Date.now()", "v.getTime() < Date.now()")  # attempt 1: validator inverted (wrong on purpose)
VIRTUAL = """
RestaurantListSchema.path('restaurants').schema.virtual('isDiscountActive').get(function () {
    return !!this.discountEndsAt && this.discountEndsAt.getTime() > Date.now();
});

module.exports = mongoose.model('RestaurantList', RestaurantListSchema);"""
TEST_SRC = """const assert = require('assert');
const RestaurantList = require('../src/modules/restaurants/models/RestaurantsList');

describe('RestaurantList discountEndsAt', () => {
    const sub = RestaurantList.schema.path('restaurants').schema;
    const field = () => sub.path('discountEndsAt');

    it('is an optional Date field', () => {
        assert.ok(field());
        assert.strictEqual(field().instance, 'Date');
        assert.ok(!field().isRequired);
    });
    it('rejects a date in the past', () => {
        assert.ok(field().doValidateSync(new Date(Date.now() - 60000)));
    });
    it('accepts a future date and an empty value', () => {
        assert.ifError(field().doValidateSync(new Date(Date.now() + 60000)));
        assert.ifError(field().doValidateSync(undefined));
    });
    it('isDiscountActive is true only before the end time', () => {
        const v = sub.virtuals.isDiscountActive;
        assert.strictEqual(v.applyGetters(undefined, { discountEndsAt: new Date(Date.now() + 60000) }), true);
        assert.strictEqual(v.applyGetters(undefined, { discountEndsAt: new Date(Date.now() - 60000) }), false);
        assert.strictEqual(v.applyGetters(undefined, {}), false);
    });
});
"""


def sh(*cmd, cwd=None):
    return subprocess.run(list(cmd), cwd=cwd, capture_output=True, text=True).stdout.strip()


async def main() -> int:
    from agents import feature_flow as ff
    from agents.devloop import run_devloop
    from core import gitops, hitl

    anchor = "        distanceFromUser: {\n            type: Number,\n            default: 0\n        },\n"
    base_sha = sh("git", "rev-parse", "HEAD", cwd=CLONE)
    prof = ff._profile(CLONE, TEST)
    assert prof, "demo clone needs node_modules (junction to D:\\Projects\\baeit\\Backend\\node_modules)"
    attempts = []

    async def implement(wt: Path, attempt: int, feedback: str) -> None:
        attempts.append({"attempt": attempt, "had_feedback": bool(feedback)})
        src = (CLONE / MODEL).read_text("utf-8")  # always start from the pristine file
        assert anchor in src
        out = src.replace(anchor, anchor + (BROKEN_FIELD if attempt == 1 else FIELD), 1).replace("\nmodule.exports = mongoose.model('RestaurantList', RestaurantListSchema);", VIRTUAL, 1)
        (wt / MODEL).write_text(out, encoding="utf-8")
        (wt / TEST).write_text(TEST_SRC, encoding="utf-8")

    t0 = time.time()
    out = await run_devloop(CLONE, ff.WORKTREES, "Add discountEndsAt + isDiscountActive to RestaurantsList", prof["cmd"], implement, sandbox=True, sandbox_opts=prof["sandbox_opts"], test_timeout=300)
    res = {"passed": out.get("passed"), "attempts": attempts, "history": out.get("history"), "branch": out.get("branch"), "seconds": round(time.time() - t0, 1)}
    if out.get("passed"):
        diff = await gitops.diff(Path(out["worktree"]), out["base"])
        res["diff_lines"] = len(diff.splitlines())
        res["files_changed"] = sh("git", "diff", "--name-only", out["base"], "HEAD", cwd=out["worktree"]).splitlines()
        res["commit_trailers"] = [ln for ln in sh("git", "log", "-1", "--format=%B", cwd=out["worktree"]).splitlines() if ln.startswith(("Agent-Id", "Model", "Prompt-Hash"))]
        ok = await hitl.gate("git.merge_main", "Flow 1 acceptance: merge agent-patch branch? (this demo never approves)", "ceo-baeit", ttl_s=4)
        res["merge_approved"] = ok
        res["main_untouched"] = sh("git", "rev-parse", "HEAD", cwd=CLONE) == base_sha and "discountEndsAt" not in (CLONE / MODEL).read_text("utf-8")
        await gitops.remove(CLONE, Path(out["worktree"]), out["branch"])
    print(json.dumps(res, indent=1))
    return 0 if res["passed"] and res.get("main_untouched") and res.get("merge_approved") is False and len(attempts) == 2 else 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
