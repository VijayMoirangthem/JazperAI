"""AES-256-GCM file encryption with a scrypt-derived key. Passphrase: env JASPER_BACKUP_PASSPHRASE, else the OS vault
entry BACKUP_PASSPHRASE (auto-generated on first use; C-11 default = local encrypted backups).
Usage: backup_crypt.py encrypt|decrypt <in> <out>"""
import os
import secrets
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend" / "python"))
from cryptography.hazmat.primitives.ciphers.aead import AESGCM  # noqa: E402
from cryptography.hazmat.primitives.kdf.scrypt import Scrypt  # noqa: E402

MAGIC = b"JBK1"


def _pass() -> bytes:
    p = os.environ.get("JASPER_BACKUP_PASSPHRASE")
    if not p:
        from core import vault
        p = vault.get("BACKUP_PASSPHRASE")
        if not p:
            p = secrets.token_urlsafe(32)
            vault.set("BACKUP_PASSPHRASE", p)
    return p.encode()


def _key(salt: bytes) -> bytes:
    return Scrypt(salt=salt, length=32, n=2**15, r=8, p=1).derive(_pass())


def main(mode: str, src: str, dst: str) -> None:
    data = Path(src).read_bytes()
    if mode == "encrypt":
        salt, nonce = secrets.token_bytes(16), secrets.token_bytes(12)
        Path(dst).write_bytes(MAGIC + salt + nonce + AESGCM(_key(salt)).encrypt(nonce, data, MAGIC))
    else:
        assert data[:4] == MAGIC, "not a Jasper backup"
        salt, nonce, ct = data[4:20], data[20:32], data[32:]
        Path(dst).write_bytes(AESGCM(_key(salt)).decrypt(nonce, ct, MAGIC))


main(*sys.argv[1:4])
