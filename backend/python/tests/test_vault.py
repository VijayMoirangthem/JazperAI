import json

import keyring
import pytest
from keyring.backend import KeyringBackend
from keyring.backends.fail import Keyring as FailKeyring

from core import vault


class MemKeyring(KeyringBackend):
    priority = 1

    def __init__(self):
        self.d = {}

    def get_password(self, s, u):
        return self.d.get((s, u))

    def set_password(self, s, u, p):
        self.d[(s, u)] = p

    def delete_password(self, s, u):
        self.d.pop((s, u), None)


@pytest.fixture
def mem():
    old = keyring.get_keyring()
    kr = MemKeyring()
    keyring.set_keyring(kr)
    yield kr
    keyring.set_keyring(old)


def test_no_plaintext_at_rest_and_roundtrip(mem):
    blob = vault.encrypt({"access_token": "SUPERSECRETVALUE"})
    assert "SUPERSECRETVALUE" not in blob
    assert vault.decrypt(blob) == {"access_token": "SUPERSECRETVALUE"}
    assert "SUPERSECRETVALUE" not in json.dumps(list(mem.d.values()))  # master keys only, never the payload


def test_named_secret_get_set(mem):
    vault.set("X_KEY", "v1")
    assert vault.get("X_KEY") == "v1"
    assert vault.get("MISSING") is None


def test_key_rotation(mem):
    old = vault.encrypt({"a": 1})
    vault.rotate()
    assert vault.decrypt(old) == {"a": 1}  # old blob still readable
    new = vault.reencrypt(old)
    vault.drop_old_keys()
    assert vault.decrypt(new) == {"a": 1}
    with pytest.raises(Exception):
        vault.decrypt(old)  # old key gone


def test_missing_keystore_fails_closed():
    old = keyring.get_keyring()
    keyring.set_keyring(FailKeyring())
    try:
        with pytest.raises(vault.VaultUnavailable):
            vault.encrypt({"a": 1})
    finally:
        keyring.set_keyring(old)
