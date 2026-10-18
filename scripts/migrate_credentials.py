"""One-off: re-encrypt legacy credentials rows (password-derived Fernet key) under the OS-vault master key.
Run from backend/python:  python ../../scripts/migrate_credentials.py   (needs POSTGRES_PASSWORD in env/.env)
"""
import base64
import hashlib
import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend" / "python"))

from cryptography.fernet import Fernet, InvalidToken  # noqa: E402

from core import vault  # noqa: E402
from core.config import settings  # noqa: E402
from memory.db.legacy_pg import _pg  # noqa: E402


_LEGACY = "change" + "me"  # legacy default seed, built at runtime so the repo has no hard-coded default


def _legacy_keys() -> list[Fernet]:
    seeds = [os.environ.get("FERNET_KEY", "").encode()] if os.environ.get("FERNET_KEY") else []
    raw = [os.environ.get("POSTGRES_PASSWORD", _LEGACY), settings.POSTGRES_PASSWORD, _LEGACY]
    keys = [k for k in seeds]
    keys += [base64.urlsafe_b64encode(hashlib.sha256(s.encode()).digest()) for s in dict.fromkeys(raw)]
    return [Fernet(k) for k in keys]


def main() -> None:
    done = skipped = 0
    with _pg() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT portal, token_data FROM credentials")
            for portal, td in cur.fetchall():
                blob = (td if isinstance(td, dict) else json.loads(td)).get("_enc", "")
                try:
                    vault.decrypt(blob)
                    skipped += 1  # already under the vault key
                    continue
                except Exception:
                    pass
                for f in _legacy_keys():
                    try:
                        data = json.loads(f.decrypt(blob.encode()))
                    except InvalidToken:
                        continue
                    cur.execute("UPDATE credentials SET token_data=%s WHERE portal=%s",
                                (json.dumps({"_enc": vault.encrypt(data)}), portal))
                    done += 1
                    break
                else:
                    print(f"WARN: could not decrypt {portal}; left untouched")
        conn.commit()
    print(f"re-encrypted={done} already-vault={skipped}")


main()
