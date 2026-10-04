"""Cursor API key. The only store is keyring, service ``2D Hero``."""

import keyring
from keyring.errors import PasswordDeleteError

KEYRING_SERVICE = "2D Hero"
KEYRING_USERNAME = "cursor_api_key"


def get_cursor_key() -> str | None:
    """The stored key, or None. Callers must not log the return value."""
    stored = keyring.get_password(KEYRING_SERVICE, KEYRING_USERNAME)
    if not stored:
        return None
    return stored


def cursor_key_is_set() -> bool:
    """True when keyring holds a non-empty Cursor key."""
    return get_cursor_key() is not None


def set_cursor_key(key: str) -> None:
    """Store the key. The caller must not log ``key``."""
    keyring.set_password(KEYRING_SERVICE, KEYRING_USERNAME, key)


def delete_cursor_key() -> None:
    """Remove the key. Missing keys are already gone."""
    try:
        keyring.delete_password(KEYRING_SERVICE, KEYRING_USERNAME)
    except PasswordDeleteError:
        return
