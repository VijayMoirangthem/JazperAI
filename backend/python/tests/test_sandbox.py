import subprocess
import sys

import pytest

from core.eventbus import EventBus
from hub import sandbox

pytestmark = pytest.mark.skipif(not sandbox.available(), reason="docker not available")
PY = "python"


@pytest.fixture
def src(tmp_path):
    (tmp_path / "hello.txt").write_text("host file")
    return tmp_path


async def run(cmd, src, **kw):
    return await sandbox.run(cmd, src, **kw)


async def test_runs_as_non_root_and_sees_a_copy_of_the_project(src):
    r = await run(["sh", "-c", "id -u; cat hello.txt"], src)
    assert r.exit_code == 0 and r.output.split() == ["1000", "host", "file"]


async def test_cannot_write_to_host_mount_or_root_filesystem(src):
    r = await run(["sh", "-c", "echo pwned > /src/hello.txt; echo $?; touch /etc/evil; echo $?"], src)
    codes = [l for l in r.output.splitlines() if l.strip().isdigit()]
    assert all(c != "0" for c in codes), r.output
    assert (src / "hello.txt").read_text() == "host file"  # host untouched
    # writes inside the copy are fine and never reach the host
    r2 = await run(["sh", "-c", "echo changed > hello.txt && cat hello.txt"], src)
    assert "changed" in r2.output and (src / "hello.txt").read_text() == "host file"


async def test_no_network_by_default(src):
    r = await run([PY, "-c", "import urllib.request; urllib.request.urlopen('http://1.1.1.1', timeout=3); print('REACHED')"], src, timeout_s=30)
    assert "REACHED" not in r.output and r.exit_code != 0


async def test_fork_bomb_is_contained_by_pids_limit(src):
    r = await run([PY, "-c", "import os\nwhile True:\n    try:\n        os.fork()\n    except OSError:\n        import time; time.sleep(30)"], src, timeout_s=8, pids=32)
    assert r.timed_out or r.exit_code != 0
    assert subprocess.run(["docker", "ps", "-q", "--filter", f"name={r.container}"], capture_output=True, text=True).stdout.strip() == ""  # gone
    assert sandbox.available()  # the host Docker daemon is still healthy


async def test_huge_output_is_truncated_and_stops_the_run(src):
    r = await run([PY, "-c", "import sys\nwhile True:\n    sys.stdout.write('x' * 1000 + '\\n'); sys.stdout.flush()"], src, max_output=20_000, timeout_s=30)
    assert r.truncated and len(r.output) <= 20_000


async def test_wall_clock_limit_kills_the_container(src):
    r = await run(["sh", "-c", "sleep 60"], src, timeout_s=3)
    assert r.timed_out and r.duration_ms < 20_000
    assert subprocess.run(["docker", "ps", "-aq", "--filter", f"name={r.container}"], capture_output=True, text=True).stdout.strip() == ""


async def test_output_streams_to_execution_log_topic(src, monkeypatch):
    b = EventBus()
    monkeypatch.setattr(sandbox, "bus", b)
    sub = b.subscribe({"execution-log"})
    from uuid import uuid4
    rid = str(uuid4())
    await run(["sh", "-c", "echo line-one; echo line-two"], src, run_id=rid)
    lines = []
    while not sub.q.empty():
        lines.append(sub.q.get_nowait().params["line"])
    assert lines == ["line-one", "line-two"]


async def test_invalid_network_value_rejected(src):
    with pytest.raises(ValueError):
        await run(["true"], src, network="host")


async def test_pytest_runs_inside_the_sandbox(src):
    (src / "test_ok.py").write_text("def test_ok():\n    assert 1 + 1 == 2\n")
    r = await run([PY, "-m", "pytest", "-q", "-p", "no:cacheprovider"], src, timeout_s=60)
    assert r.exit_code == 0 and "1 passed" in r.output
