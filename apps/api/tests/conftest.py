from collections.abc import Iterator

import keyring
import pytest
from fastapi.testclient import TestClient

from memory_keyring import MemoryKeyring

TOKEN = "phase1-test-token"


@pytest.fixture(autouse=True)
def memory_keyring() -> Iterator[MemoryKeyring]:
    """Inject an in-memory backend so tests never call Windows Credential Manager."""
    backend = MemoryKeyring()
    keyring.set_keyring(backend)
    yield backend


@pytest.fixture
def token() -> str:
    return TOKEN


@pytest.fixture
def client(tmp_path, token: str) -> Iterator[TestClient]:
    from hero.app import create_app

    app = create_app(
        token=token,
        config_dir=tmp_path / "config",
        projects_dir=tmp_path / "projects",
        session_file=tmp_path / ".session-token",
        open_file=lambda: None,
    )
    with TestClient(app, base_url="http://127.0.0.1") as test_client:
        yield test_client
