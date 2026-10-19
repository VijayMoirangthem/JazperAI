"""OS-keystore vault (spec §11/§14): Windows Credential Manager via `keyring`.

- Named secrets:   vault.get("ANTHROPIC_API_KEY") / vault.set(name, value)       -> stored directly in the keystore
- Blob encryption: vault.encrypt(dict) / vault.decrypt(str)                      -> Fernet with master keys held in the keystore
  (credential size limits make the keystore unsuitable for large blobs, so only the master keys live there).
Master keys are a newest-first list so rotation keeps old blobs readable (MultiFernet) until re-encrypted.
Values are never logged. No password-derived fallback exists: a missing/locked keystore raises VaultUnavailable.
"""
import json

import structlog
from cryptography.fernet import Fernet, MultiFernet

log = structlog.get_logger()
SERVICE = "jasper"
_KEYS_ENTRY = "__master_keys__"


class VaultUnavailable(RuntimeError):
    pass


def _kr():
    try:
        import keyring
        return keyring
    except ImportError as e:  # pragma: no cover
        raise VaultUnavailable("keyring package not installed") from e


def _read(name: str) -> str | None:
    try:
        return _kr().get_password(SERVICE, name)
    except VaultUnavailable:
        raise
    except Exception as e:
        raise VaultUnavailable(f"keystore unavailable: {type(e).__name__}") from e


def _write(name: str, value: str) -> None:
    try:
        _kr().set_password(SERVICE, name, value)
    except Exception as e:
        raise VaultUnavailable(f"keystore unavailable: {type(e).__name__}") from e


def get(name: str) -> str | None:
    return _read(name)


def set(name: str, value: str) -> None:  # noqa: A001
    _write(name, value)
    log.info("vault secret set", name=name)


def _master_keys(create: bool = True) -> list[str]:
    raw = _read(_KEYS_ENTRY)
    if raw:
        return json.loads(raw)
    if not create:
        return []
    keys = [Fernet.generate_key().decode()]
    _write(_KEYS_ENTRY, json.dumps(keys))
    log.info("vault master key created")
    return keys


def _fernet() -> MultiFernet:
    return MultiFernet([Fernet(k.encode()) for k in _master_keys()])


def rotate() -> None:
    """Add a new primary master key; old keys stay for decryption until blobs are re-encrypted with reencrypt()."""
    _write(_KEYS_ENTRY, json.dumps([Fernet.generate_key().decode(), *_master_keys()]))
    log.info("vault master key rotated")


def drop_old_keys() -> None:
    _write(_KEYS_ENTRY, json.dumps(_master_keys()[:1]))


def encrypt(data: dict) -> str:
    return _fernet().encrypt(json.dumps(data).encode()).decode()


def decrypt(blob: str) -> dict:
    return json.loads(_fernet().decrypt(blob.encode()))


def reencrypt(blob: str) -> str:
    """Re-encrypt under the current primary key (after rotate())."""
    return _fernet().rotate(blob.encode()).decode()


def delete(name: str) -> None:
    try:
        _kr().delete_password(SERVICE, name)
    except Exception:
        pass  # already absent
    log.info("vault secret deleted", name=name)
