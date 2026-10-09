"""Phase 23: the project records the last PDF saved to Trimble Connect as ``trimbleExport``.

The route is hosted only. It holds ids, a name, and a time. A URL or a token is refused.
"""

import asyncio
import time
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi.testclient import TestClient

from hero.app import create_app
from hero.hosted import HostedConfig
from hero.projects import ProjectStore

HOST = "2dhero.example.com"
PUBLIC_URL = f"https://{HOST}"
ISSUER = "https://id.example.test"
AUDIENCE = "2d-hero-client-id"
JWKS_URL = "https://id.example.test/jwks.json"
LOCAL_TOKEN = "local-session-token-for-export-tests"

TOKEN_SHAPED = (
    "eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJ1c2VyLTEifQ.c2lnbmF0dXJlLWJ5dGVzLWhlcmU"
)


@pytest.fixture(scope="module")
def signing_key() -> rsa.RSAPrivateKey:
    return rsa.generate_private_key(public_exponent=65537, key_size=2048)


def make_token(key: rsa.RSAPrivateKey) -> str:
    now = int(time.time())
    return jwt.encode(
        {"iss": ISSUER, "aud": AUDIENCE, "sub": "user-1", "iat": now, "exp": now + 600},
        key,
        algorithm="RS256",
    )


def config() -> HostedConfig:
    return HostedConfig(
        public_url=PUBLIC_URL,
        allowed_hosts=(HOST,),
        cors_origins=(),
        frame_ancestors=("https://web.connect.trimble.com",),
        issuer=ISSUER,
        audience=AUDIENCE,
        jwks_url=JWKS_URL,
    )


def make_project(tmp_path: Path) -> str:
    store = ProjectStore(tmp_path / "projects", tmp_path / "config")

    async def read(_size: int) -> bytes:
        return b""

    stored = asyncio.run(store.create_from_chunks("scan.glb", read, "Office"))
    return stored.id


@pytest.fixture
def hosted(
    tmp_path: Path, signing_key: rsa.RSAPrivateKey
) -> Iterator[tuple[TestClient, str, dict[str, str]]]:
    project_id = make_project(tmp_path)
    app = create_app(
        token=LOCAL_TOKEN,
        config_dir=tmp_path / "config",
        projects_dir=tmp_path / "projects",
        hosted=config(),
        key_provider=lambda _token: signing_key.public_key(),
    )
    headers = {"Authorization": f"Bearer {make_token(signing_key)}"}
    with TestClient(app, base_url=PUBLIC_URL) as client:
        yield client, project_id, headers


def export_body(**extra: object) -> dict[str, object]:
    payload: dict[str, object] = {
        "fileId": "file-77",
        "versionId": "ver-2",
        "folderId": "folder-5",
        "name": "Office.pdf",
        "savedAt": "2026-10-09T12:30:00+00:00",
    }
    payload.update(extra)
    return payload


def test_export_is_recorded_and_returned(hosted: tuple[TestClient, str, dict[str, str]]) -> None:
    client, project_id, headers = hosted

    saved = client.put(
        f"/api/projects/{project_id}/trimble-export", json=export_body(), headers=headers
    )
    assert saved.status_code == 200

    described = client.get(f"/api/projects/{project_id}", headers=headers).json()
    assert described["trimbleExport"] == export_body()


def test_second_export_replaces_the_first(hosted: tuple[TestClient, str, dict[str, str]]) -> None:
    client, project_id, headers = hosted
    client.put(f"/api/projects/{project_id}/trimble-export", json=export_body(), headers=headers)

    client.put(
        f"/api/projects/{project_id}/trimble-export",
        json=export_body(versionId="ver-3"),
        headers=headers,
    )

    described = client.get(f"/api/projects/{project_id}", headers=headers).json()
    assert described["trimbleExport"]["versionId"] == "ver-3"


@pytest.mark.parametrize(
    "field,value",
    [
        ("name", "https://files.example.test/a.pdf"),
        ("fileId", "https://files.example.test/blob?sig=abc"),
        ("versionId", TOKEN_SHAPED),
        ("folderId", TOKEN_SHAPED),
        ("name", f"Bearer {TOKEN_SHAPED}"),
        ("name", "plan.pdf?X-Amz-Signature=abc"),
    ],
)
def test_url_or_token_value_is_rejected_with_400(
    hosted: tuple[TestClient, str, dict[str, str]], field: str, value: str
) -> None:
    client, project_id, headers = hosted

    response = client.put(
        f"/api/projects/{project_id}/trimble-export",
        json=export_body(**{field: value}),
        headers=headers,
    )

    assert response.status_code == 400
    assert value not in response.text
    described = client.get(f"/api/projects/{project_id}", headers=headers).json()
    assert "trimbleExport" not in described


@pytest.mark.parametrize("field", ["fileId", "versionId", "folderId", "name", "savedAt"])
def test_empty_field_is_rejected_with_400(
    hosted: tuple[TestClient, str, dict[str, str]], field: str
) -> None:
    client, project_id, headers = hosted

    response = client.put(
        f"/api/projects/{project_id}/trimble-export",
        json=export_body(**{field: ""}),
        headers=headers,
    )

    assert response.status_code == 400


def test_unknown_project_is_404(hosted: tuple[TestClient, str, dict[str, str]]) -> None:
    client, _project_id, headers = hosted

    response = client.put(
        f"/api/projects/{'0' * 32}/trimble-export", json=export_body(), headers=headers
    )

    assert response.status_code == 404


def test_export_without_bearer_is_401(hosted: tuple[TestClient, str, dict[str, str]]) -> None:
    client, project_id, _headers = hosted

    response = client.put(f"/api/projects/{project_id}/trimble-export", json=export_body())

    assert response.status_code == 401


def test_local_mode_returns_404(client: TestClient, token: str) -> None:
    created = client.post(
        "/api/projects", json={"name": "Local"}, headers={"X-Hero-Token": token}
    )
    project_id: Any = created.json().get("id", "0" * 32)

    response = client.put(
        f"/api/projects/{project_id}/trimble-export",
        json=export_body(),
        headers={"X-Hero-Token": token},
    )

    assert response.status_code == 404


def test_project_without_the_field_loads_unchanged(
    hosted: tuple[TestClient, str, dict[str, str]],
) -> None:
    client, project_id, headers = hosted

    described = client.get(f"/api/projects/{project_id}", headers=headers).json()

    assert "trimbleExport" not in described
    assert described["name"] == "Office"
