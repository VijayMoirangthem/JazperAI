"""Ephemeral Docker sandbox runner (spec §10): one-shot containers for anything an agent wants to execute.

Hardening: read-only root filesystem, non-root user, all capabilities dropped, no-new-privileges, pids/memory/cpu limits, tmpfs
workdir, the project mounted READ-ONLY at /src and copied into the tmpfs /work (copy-on-write: the host tree is never written),
no network by default, output size cap, wall-clock limit. Output streams to the `execution-log` bus topic.
Egress allow-listing through a proxy container is not implemented: network is either "none" (default) or explicitly "bridge".
"""
import asyncio
import subprocess
import threading
import time
from dataclasses import dataclass
from pathlib import Path
from uuid import uuid4

import structlog

from core.eventbus import bus

log = structlog.get_logger()
IMAGE = "jasper-sandbox:py311"
DOCKERFILE = """FROM python:3.11-slim
RUN pip install --no-cache-dir pytest && useradd -m -u 1000 sbx
WORKDIR /work
"""


@dataclass
class SandboxResult:
    exit_code: int
    output: str
    timed_out: bool
    truncated: bool
    duration_ms: int
    container: str


def _docker(*args: str, timeout: float = 120, input_: bytes | None = None) -> subprocess.CompletedProcess:
    return subprocess.run(["docker", *args], capture_output=True, timeout=timeout, input=input_)


def available() -> bool:
    try:
        return _docker("info", timeout=10).returncode == 0
    except Exception:
        return False


async def ensure_image() -> None:
    if _docker("image", "inspect", IMAGE, timeout=20).returncode == 0:
        return
    log.info("building sandbox image", image=IMAGE)
    r = await asyncio.to_thread(_docker, "build", "-t", IMAGE, "-", timeout=600, input_=DOCKERFILE.encode())
    if r.returncode != 0:
        raise RuntimeError("sandbox image build failed: " + r.stderr.decode(errors="ignore")[-300:])


def _run_blocking(cmd: list[str], src: Path, network: str, timeout_s: float, mem: str, cpus: str, pids: int, max_output: int,
                  run_id: str, image: str = IMAGE, ro_mounts: tuple = ()) -> SandboxResult:
    name = f"jasper-sbx-{uuid4().hex[:10]}"
    docker_cmd = [
        "docker", "run", "--rm", "--name", name, "--read-only", "--user", "1000:1000", "--cap-drop", "ALL",
        "--security-opt", "no-new-privileges", "--pids-limit", str(pids), "--memory", mem, "--memory-swap", mem, "--cpus", cpus,
        "--network", network, "--tmpfs", "/tmp:rw,size=64m", "--tmpfs", "/work:rw,exec,size=256m,uid=1000,gid=1000",
        "-v", f"{src.resolve()}:/src:ro", *[x for host, inside in ro_mounts for x in ("-v", f"{Path(host).resolve()}:{inside}:ro")],
        "-e", "HOME=/tmp", "-e", "PYTHONDONTWRITEBYTECODE=1", image,
        "sh", "-c", 'cp -a /src/. /work/ 2>/dev/null; cd /work && exec "$@"', "sh", *cmd,
    ]
    t0 = time.monotonic()
    proc = subprocess.Popen(docker_cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    buf: list[bytes] = []
    state = {"size": 0, "truncated": False}

    def reader():
        for line in iter(proc.stdout.readline, b""):
            if state["truncated"]:
                continue  # keep draining so the container is not blocked on a full pipe while it is being killed
            if state["size"] + len(line) > max_output:
                state["truncated"] = True
                threading.Thread(target=lambda: _docker("kill", name, timeout=60), daemon=True).start()  # an output flood ends the run
                continue
            state["size"] += len(line)
            buf.append(line)
            try:
                bus.publish({"topic": "execution-log", "run_id": run_id, "stream": "stdout", "line": line.decode(errors="replace").rstrip()[:2000]})
            except Exception:
                pass

    t = threading.Thread(target=reader, daemon=True)
    t.start()
    timed_out = False
    try:
        proc.wait(timeout=timeout_s)
    except subprocess.TimeoutExpired:
        timed_out = True
        _docker("kill", name, timeout=15)
        proc.wait(timeout=20)
    t.join(timeout=30)
    return SandboxResult(proc.returncode if proc.returncode is not None else -1, b"".join(buf).decode(errors="replace"), timed_out,
                         state["truncated"], int((time.monotonic() - t0) * 1000), name)


async def run(cmd: list[str], src: Path, *, network: str = "none", timeout_s: float = 60, mem: str = "512m", cpus: str = "1",
              pids: int = 128, max_output: int = 65536, run_id: str | None = None, image: str = IMAGE, ro_mounts: tuple = ()) -> SandboxResult:
    """image: default is the Python sandbox; pass e.g. node:20-alpine for JS projects. ro_mounts: ((host_path, container_path), ...) mounted read-only."""
    if network not in ("none", "bridge"):
        raise ValueError("network must be 'none' or 'bridge'")
    if image == IMAGE:
        await ensure_image()
    return await asyncio.to_thread(_run_blocking, cmd, src, network, timeout_s, mem, cpus, pids, max_output, run_id or str(uuid4()), image, ro_mounts)
