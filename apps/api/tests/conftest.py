from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient

TOKEN = "phase1-test-token"


@pytest.fixture
def token() -> str:
    return TOKEN


@pytest.fixture
def client(tmp_path, token: str) -> Iterator[TestClient]:
    from hero.app import create_app

    app = create_app(
        token=token,
        config_dir=tmp_path,
        session_file=tmp_path / ".session-token",
    )
    with TestClient(app, base_url="http://127.0.0.1") as test_client:
        yield test_client
