"""Import storage/hive (tasks, log, board) into Postgres idempotently, then print a parity report
(counts + sha256 of canonical JSON, files vs DB). Exit 1 on mismatch. Run from backend/python."""
import hashlib
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend" / "python"))

from core.services import hive_service as h  # noqa: E402


def sha(o) -> str:
    return hashlib.sha256(json.dumps(o, sort_keys=True).encode()).hexdigest()[:16]


def main() -> int:
    ft, fl, fb = h._file_read_tasks(), h._file_read_log(10**9), h._file_read_board()
    h._pg_write_tasks(ft)

    def load(cur):
        cur.execute("DELETE FROM co.hive_log")
        for e in fl:
            cur.execute("INSERT INTO co.hive_log (data) VALUES (%s)", (json.dumps(e),))
        cur.execute("INSERT INTO co.hive_board (id, body) VALUES (1,%s) ON CONFLICT (id) DO UPDATE SET body=EXCLUDED.body", (fb,))
    h._pg_try(load)
    dt, dl, db = h._pg_read_tasks() or {k: [] for k in h._STATUSES}, h.read_log(10**9), h.read_board()
    rows = [("tasks", sum(map(len, ft.values())), sum(map(len, dt.values())), sha(ft), sha(dt)),
            ("log", len(fl), len(dl), sha(fl), sha(dl)), ("board", len(fb), len(db), sha(fb), sha(db))]
    ok = True
    for n, c1, c2, s1, s2 in rows:
        good = c1 == c2 and s1 == s2
        ok &= good
        print(f"{n:6} files={c1} db={c2} {s1} {s2} {'OK' if good else 'MISMATCH'}")
    return 0 if ok else 1


sys.exit(main())
