"""Point-in-time recovery drill (Plan V3 W7). Proves the WAL archive in MinIO can rebuild the database at a chosen moment, and times it.

What it does (the live database is only READ, apart from one small probe table that is dropped at the end):
  1. pg_basebackup of the live Postgres container.
  2. writes probe row A, notes the target time T, waits, writes probe row B, forces a WAL switch and waits until the segments are in MinIO `wal`.
  3. downloads the base + WAL from MinIO, restores into a scratch container with recovery_target_time = T.
  4. PASS if the scratch database has A but not B. Prints seconds for the restore (RTO of PITR).

    backend\\.venv\\Scripts\\python.exe scripts\\pitr_drill.py
"""
import json
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "backend" / "python"))
IMAGE = "pgvector/pgvector:0.8.0-pg16"


def env(name: str) -> str:
    for ln in (ROOT / "infra" / ".env").read_text(encoding="utf-8").splitlines():
        if ln.startswith(name + "="):
            return ln.split("=", 1)[1].strip()
    raise SystemExit(f"{name} missing in infra/.env")


def run(*cmd: str, check: bool = True, **kw) -> subprocess.CompletedProcess:
    r = subprocess.run(list(cmd), capture_output=True, text=True, **kw)
    if check and r.returncode != 0:
        raise SystemExit(f"command failed: {' '.join(cmd)[:120]}\n{(r.stderr or r.stdout)[-400:]}")
    return r


def psql_live(sql: str) -> str:
    return run("docker", "exec", "jasper-postgres", "psql", "-U", USER, "-d", DB, "-tA", "-c", sql).stdout.strip()


def main() -> int:
    from core import objectstore
    global USER, DB
    USER, DB = env("POSTGRES_USER"), env("POSTGRES_DB")
    work = Path(tempfile.mkdtemp(prefix="jasper-pitr-"))
    (work / "wal").mkdir()
    t_start = time.time()
    try:
        psql_live("DROP TABLE IF EXISTS shared.pitr_probe; CREATE TABLE shared.pitr_probe(v text, ts timestamptz DEFAULT now())")
        # 1) base backup (WAL comes from the archive, not from the backup)
        run("docker", "exec", "jasper-postgres", "sh", "-c", f"rm -rf /tmp/base && pg_basebackup -U {USER} -D /tmp/base -Ft -z -X none -c fast")
        run("docker", "cp", "jasper-postgres:/tmp/base/base.tar.gz", str(work / "base.tar.gz"))
        run("docker", "exec", "jasper-postgres", "rm", "-rf", "/tmp/base")
        objectstore.put_file("backups", f"pitr-drill/{time.strftime('%Y%m%d-%H%M%S')}/base.tar.gz", str(work / "base.tar.gz"))
        # 2) before / target / after
        psql_live("INSERT INTO shared.pitr_probe(v) VALUES ('A-before-target')")
        time.sleep(3)
        target = psql_live("SELECT to_char(now(), 'YYYY-MM-DD HH24:MI:SS.US TZH')")
        time.sleep(3)
        psql_live("INSERT INTO shared.pitr_probe(v) VALUES ('B-after-target')")
        psql_live("SELECT pg_switch_wal()")
        newest = psql_live("SELECT pg_walfile_name(pg_current_wal_lsn())")
        print(f"base backup {(work / 'base.tar.gz').stat().st_size // 1024} KB; recovery target {target}")
        # wait until the shipper has the segment that holds B (the one before the current one) in MinIO
        deadline = time.time() + 120
        while time.time() < deadline:
            names = {o.object_name for o in objectstore.client().list_objects("wal", recursive=True)}
            archived = int(psql_live("SELECT archived_count FROM pg_stat_archiver"))
            if archived > 0 and any(n > newest[:-1] + "0" for n in names) or newest in names:
                break
            time.sleep(3)
        time.sleep(25)  # let the next 20-second sync pass finish
        # 3) restore into a scratch container
        t_restore = time.time()
        for o in objectstore.client().list_objects("wal", recursive=True):
            objectstore.client().fget_object("wal", o.object_name, str(work / "wal" / o.object_name))
        (work / "append.conf").write_text(f"restore_command = 'cp /wal/%f %p'\nrecovery_target_time = '{target}'\nrecovery_target_action = 'promote'\narchive_mode = off\n", encoding="utf-8")
        run("docker", "rm", "-f", "jasper-pitr", check=False)
        run("docker", "volume", "rm", "-f", "jasper_pitr", check=False)
        run("docker", "volume", "create", "jasper_pitr")
        run("docker", "run", "--rm", "-u", "0", "-v", "jasper_pitr:/data", "-v", f"{work}:/in", IMAGE, "sh", "-c",
            "tar xzf /in/base.tar.gz -C /data && cat /in/append.conf >> /data/postgresql.auto.conf && touch /data/recovery.signal && chown -R postgres:postgres /data && chmod 700 /data")
        run("docker", "run", "-d", "--name", "jasper-pitr", "-v", "jasper_pitr:/var/lib/postgresql/data", "-v", f"{work}/wal:/wal:ro", "-e", "POSTGRES_PASSWORD=drill", IMAGE)
        rows = ""
        for _ in range(90):
            time.sleep(2)
            r = run("docker", "exec", "jasper-pitr", "psql", "-U", USER, "-d", DB, "-tA", "-c", "SELECT pg_is_in_recovery()::text || '|' || (SELECT string_agg(v, ',' ORDER BY ts) FROM shared.pitr_probe)", check=False)
            if r.returncode == 0 and r.stdout.strip().startswith("false"):
                rows = r.stdout.strip().split("|", 1)[1]
                break
        restore_s = round(time.time() - t_restore, 1)
        ok = rows == "A-before-target"
        print(json.dumps({"pitr_pass": ok, "scratch_rows": rows, "expected": "A-before-target (B must be absent)", "restore_seconds": restore_s, "wal_segments": len(list((work / "wal").iterdir())), "total_seconds": round(time.time() - t_start, 1)}))
        return 0 if ok else 1
    finally:
        run("docker", "rm", "-f", "jasper-pitr", check=False)
        run("docker", "volume", "rm", "-f", "jasper_pitr", check=False)
        try:
            psql_live("DROP TABLE IF EXISTS shared.pitr_probe")
        except SystemExit:
            pass
        shutil.rmtree(work, ignore_errors=True)


if __name__ == "__main__":
    sys.exit(main())
