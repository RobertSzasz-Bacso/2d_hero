"""Phase 21: hosted Trimble Connect authentication, CORS, and secret handling."""

import logging
import time
from collections.abc import Iterator
from pathlib import Path

import jwt
import keyring
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi.testclient import TestClient

from hero.app import create_app
from hero.hosted import HostedConfig, HostedConfigError

HOST = "2dhero.example.com"
PUBLIC_URL = f"https://{HOST}"
ISSUER = "https://id.example.test"
AUDIENCE = "2d-hero-client-id"
JWKS_URL = "https://id.example.test/jwks.json"
LOCAL_TOKEN = "local-session-token-for-hosted-tests"
TRIMBLE_ORIGIN = "https://web.connect.trimble.com"


@pytest.fixture(scope="module")
def signing_key() -> rsa.RSAPrivateKey:
    return rsa.generate_private_key(public_exponent=65537, key_size=2048)


@pytest.fixture(scope="module")
def other_key() -> rsa.RSAPrivateKey:
    return rsa.generate_private_key(public_exponent=65537, key_size=2048)


def make_token(
    key: rsa.RSAPrivateKey,
    *,
    issuer: str = ISSUER,
    audience: str = AUDIENCE,
    expires_in: int = 600,
    algorithm: str = "RS256",
    extra: dict[str, object] | None = None,
) -> str:
    now = int(time.time())
    claims: dict[str, object] = {
        "iss": issuer,
        "aud": audience,
        "sub": "user-1",
        "iat": now,
        "exp": now + expires_in,
    }
    claims.update(extra or {})
    return jwt.encode(claims, key, algorithm=algorithm)


def hosted_config() -> HostedConfig:
    return HostedConfig(
        public_url=PUBLIC_URL,
        allowed_hosts=(HOST,),
        cors_origins=(TRIMBLE_ORIGIN,),
        frame_ancestors=(TRIMBLE_ORIGIN,),
        issuer=ISSUER,
        audience=AUDIENCE,
        jwks_url=JWKS_URL,
    )


@pytest.fixture
def hosted_client(tmp_path: Path, signing_key: rsa.RSAPrivateKey) -> Iterator[TestClient]:
    app = create_app(
        token=LOCAL_TOKEN,
        config_dir=tmp_path / "config",
        projects_dir=tmp_path / "projects",
        hosted=hosted_config(),
        key_provider=lambda _token: signing_key.public_key(),
    )
    with TestClient(app, base_url=PUBLIC_URL) as client:
        yield client


def bearer(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


# --- authentication -------------------------------------------------------


def test_valid_token_reaches_protected_route(hosted_client, signing_key) -> None:
    response = hosted_client.get("/api/hosted/session", headers=bearer(make_token(signing_key)))

    assert response.status_code == 200
    assert response.json() == {"authenticated": True}


def test_valid_token_lists_projects(hosted_client, signing_key) -> None:
    response = hosted_client.get("/api/projects", headers=bearer(make_token(signing_key)))

    assert response.status_code == 200
    assert response.json() == []


def test_health_needs_no_token(hosted_client) -> None:
    response = hosted_client.get("/api/health")

    assert response.status_code == 200
    assert response.json() == {"ok": True}


def test_missing_credentials_is_401(hosted_client) -> None:
    for path in ("/api/projects", "/api/settings", "/api/hosted/session", "/api/not-a-route"):
        response = hosted_client.get(path)
        assert response.status_code == 401, path
        assert response.json() == {"detail": "Unauthorized"}


@pytest.mark.parametrize(
    "header",
    ["", "Bearer", "Bearer ", "Basic abc", "bearer", "Token abc.def.ghi", "Bearer not-a-jwt"],
)
def test_malformed_authorization_is_401(hosted_client, header: str) -> None:
    response = hosted_client.get("/api/projects", headers={"Authorization": header})

    assert response.status_code == 401


def test_token_signed_by_another_key_is_401(hosted_client, other_key) -> None:
    response = hosted_client.get("/api/projects", headers=bearer(make_token(other_key)))

    assert response.status_code == 401


def test_expired_token_is_401(hosted_client, signing_key) -> None:
    token = make_token(signing_key, expires_in=-120)

    assert hosted_client.get("/api/projects", headers=bearer(token)).status_code == 401


def test_wrong_audience_is_401(hosted_client, signing_key) -> None:
    token = make_token(signing_key, audience="someone-else")

    assert hosted_client.get("/api/projects", headers=bearer(token)).status_code == 401


def test_wrong_issuer_is_401(hosted_client, signing_key) -> None:
    token = make_token(signing_key, issuer="https://evil.example")

    assert hosted_client.get("/api/projects", headers=bearer(token)).status_code == 401


def test_token_without_expiry_is_401(hosted_client, signing_key) -> None:
    now = int(time.time())
    token = jwt.encode({"iss": ISSUER, "aud": AUDIENCE, "iat": now}, signing_key, "RS256")

    assert hosted_client.get("/api/projects", headers=bearer(token)).status_code == 401


def test_unsigned_token_is_401(hosted_client) -> None:
    import base64
    import json

    def b64(data: bytes) -> str:
        return base64.urlsafe_b64encode(data).rstrip(b"=").decode()

    now = int(time.time())
    header = b64(json.dumps({"alg": "none", "typ": "JWT"}).encode())
    body = b64(json.dumps({"iss": ISSUER, "aud": AUDIENCE, "exp": now + 600}).encode())
    token = f"{header}.{body}."

    assert hosted_client.get("/api/projects", headers=bearer(token)).status_code == 401


def test_hs256_token_signed_with_public_key_is_401(hosted_client, signing_key) -> None:
    import base64
    import hashlib
    import hmac
    import json

    from cryptography.hazmat.primitives import serialization

    def b64(data: bytes) -> bytes:
        return base64.urlsafe_b64encode(data).rstrip(b"=")

    public_pem = signing_key.public_key().public_bytes(
        serialization.Encoding.PEM,
        serialization.PublicFormat.SubjectPublicKeyInfo,
    )
    now = int(time.time())
    header = b64(json.dumps({"alg": "HS256", "typ": "JWT"}).encode())
    body = b64(json.dumps({"iss": ISSUER, "aud": AUDIENCE, "exp": now + 600}).encode())
    signing_input = header + b"." + body
    mac = hmac.new(public_pem, signing_input, hashlib.sha256).digest()
    forged = (signing_input + b"." + b64(mac)).decode()

    assert hosted_client.get("/api/projects", headers=bearer(forged)).status_code == 401


def test_oversized_token_is_401(hosted_client) -> None:
    response = hosted_client.get("/api/projects", headers=bearer("a." * 10_000))

    assert response.status_code == 401


def test_local_session_header_is_not_accepted_when_hosted(hosted_client) -> None:
    response = hosted_client.get("/api/projects", headers={"X-Hero-Token": LOCAL_TOKEN})

    assert response.status_code == 401


def test_key_lookup_failure_is_401(tmp_path, signing_key) -> None:
    def broken(_token: str):
        raise RuntimeError("jwks unreachable")

    app = create_app(
        token=LOCAL_TOKEN,
        config_dir=tmp_path / "config",
        projects_dir=tmp_path / "projects",
        hosted=hosted_config(),
        key_provider=broken,
    )
    with TestClient(app, base_url=PUBLIC_URL) as client:
        response = client.get("/api/projects", headers=bearer(make_token(signing_key)))

    assert response.status_code == 401
    assert response.json() == {"detail": "Unauthorized"}


# --- local mode stays as it was ------------------------------------------


def test_bearer_token_is_not_accepted_in_local_mode(client, signing_key) -> None:
    response = client.get("/api/projects", headers=bearer(make_token(signing_key)))

    assert response.status_code == 401


def test_local_mode_has_no_hosted_session_route(client, token: str) -> None:
    response = client.get("/api/hosted/session", headers={"X-Hero-Token": token})

    assert response.status_code == 404


def test_local_mode_still_rejects_foreign_host() -> None:
    app = create_app(token=LOCAL_TOKEN)
    with TestClient(app, base_url=PUBLIC_URL) as foreign:
        assert foreign.get("/api/health").status_code == 400


def test_local_mode_sends_no_frame_ancestors(client) -> None:
    response = client.get("/api/health")

    assert "content-security-policy" not in response.headers


# --- host, CORS, framing --------------------------------------------------


def test_unlisted_host_is_400(tmp_path, signing_key) -> None:
    app = create_app(
        token=LOCAL_TOKEN,
        config_dir=tmp_path / "config",
        projects_dir=tmp_path / "projects",
        hosted=hosted_config(),
        key_provider=lambda _token: signing_key.public_key(),
    )
    for host in ("http://evil.example", "http://127.0.0.1", "http://localhost"):
        with TestClient(app, base_url=host) as foreign:
            response = foreign.get("/api/health")
        assert response.status_code == 400, host


def test_cors_allows_only_configured_origin(hosted_client) -> None:
    allowed = hosted_client.options(
        "/api/projects",
        headers={
            "Origin": TRIMBLE_ORIGIN,
            "Access-Control-Request-Method": "GET",
            "Access-Control-Request-Headers": "authorization",
        },
    )
    foreign = hosted_client.options(
        "/api/projects",
        headers={
            "Origin": "https://evil.example",
            "Access-Control-Request-Method": "GET",
            "Access-Control-Request-Headers": "authorization",
        },
    )

    assert allowed.status_code == 200
    assert allowed.headers["access-control-allow-origin"] == TRIMBLE_ORIGIN
    assert "authorization" in allowed.headers["access-control-allow-headers"].lower()
    assert "access-control-allow-credentials" not in allowed.headers
    assert foreign.status_code == 400
    assert "access-control-allow-origin" not in foreign.headers


def test_cors_never_uses_wildcard_or_local_origins(hosted_client, signing_key) -> None:
    response = hosted_client.get(
        "/api/projects",
        headers={**bearer(make_token(signing_key)), "Origin": "http://localhost:5173"},
    )

    assert "access-control-allow-origin" not in response.headers


def test_frame_ancestors_limits_embedding(hosted_client) -> None:
    response = hosted_client.get("/api/health")

    policy = response.headers["content-security-policy"]
    assert policy == f"frame-ancestors {TRIMBLE_ORIGIN}"
    assert "x-frame-options" not in response.headers


def test_manifest_is_public_and_secret_free(hosted_client) -> None:
    response = hosted_client.get("/trimble/manifest.json")

    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == "*"
    manifest = response.json()
    assert manifest["title"] == "2D Hero"
    assert manifest["url"] == f"{PUBLIC_URL}/"
    assert manifest["extensionType"] == ["project"]
    assert manifest["enabled"] is True
    text = response.text
    for secret in (LOCAL_TOKEN, AUDIENCE, ISSUER, JWKS_URL):
        assert secret not in text


def test_manifest_is_absent_in_local_mode(client) -> None:
    assert client.get("/trimble/manifest.json").status_code == 404


# --- local-only routes are closed ----------------------------------------


def test_native_dialog_is_forbidden_when_hosted(hosted_client, signing_key) -> None:
    response = hosted_client.post("/api/dialogs/open-file", headers=bearer(make_token(signing_key)))

    assert response.status_code == 403


def test_cursor_key_cannot_be_written_when_hosted(hosted_client, signing_key) -> None:
    headers = bearer(make_token(signing_key))

    put = hosted_client.put("/api/settings/cursor-key", json={"key": "secret"}, headers=headers)
    delete = hosted_client.delete("/api/settings/cursor-key", headers=headers)

    assert put.status_code == 403
    assert delete.status_code == 403
    assert keyring.get_password("2D Hero", "cursor_api_key") is None


def test_linked_project_is_forbidden_when_hosted(hosted_client, signing_key, tmp_path) -> None:
    source = tmp_path / "room.obj"
    source.write_text("v 0 0 0\n", encoding="utf-8")

    response = hosted_client.post(
        "/api/projects",
        json={"linkPath": str(source)},
        headers=bearer(make_token(signing_key)),
    )

    assert response.status_code == 403


# --- secret handling ------------------------------------------------------


def _signature(token: str) -> str:
    return token.rsplit(".", 1)[1]


def test_token_is_never_logged_or_returned(
    hosted_client, signing_key, other_key, caplog: pytest.LogCaptureFixture
) -> None:
    good = make_token(signing_key)
    forged = make_token(other_key)
    expired = make_token(signing_key, expires_in=-120)
    bodies: list[str] = []

    with caplog.at_level(logging.DEBUG):
        for token in (good, forged, expired):
            for path in ("/api/hosted/session", "/api/projects", "/api/settings"):
                response = hosted_client.get(path, headers=bearer(token))
                bodies.append(response.text)
                bodies.append(str(dict(response.headers)))
        malformed = hosted_client.get("/api/projects", headers=bearer("garbage.token.value"))
        bodies.append(malformed.text)

    logged = "\n".join(record.getMessage() for record in caplog.records)
    logged += "\n".join(str(record.__dict__) for record in caplog.records)
    for token in (good, forged, expired):
        for haystack in (logged, *bodies):
            assert token not in haystack
            assert _signature(token) not in haystack
    assert "garbage.token.value" not in logged


def test_token_is_never_written_to_disk(hosted_client, signing_key, tmp_path: Path) -> None:
    good = make_token(signing_key)
    headers = bearer(good)

    current = hosted_client.get("/api/settings", headers=headers)
    assert current.status_code == 200
    saved = hosted_client.put("/api/settings", json=current.json(), headers=headers)
    assert saved.status_code == 200
    hosted_client.get("/api/projects", headers=headers)
    hosted_client.get("/api/hosted/session", headers=headers)

    for path in tmp_path.rglob("*"):
        if path.is_file():
            data = path.read_bytes()
            assert good.encode() not in data, path
            assert _signature(good).encode() not in data, path
    assert not (tmp_path / "config" / "session.token").exists()


# --- configuration --------------------------------------------------------


def _env(**overrides: str) -> dict[str, str]:
    base = {
        "HERO_HOSTED_PUBLIC_URL": PUBLIC_URL,
        "HERO_HOSTED_ALLOWED_HOSTS": HOST,
        "HERO_HOSTED_CORS_ORIGINS": TRIMBLE_ORIGIN,
        "HERO_TRIMBLE_ISSUER": ISSUER,
        "HERO_TRIMBLE_AUDIENCE": AUDIENCE,
        "HERO_TRIMBLE_JWKS_URL": JWKS_URL,
    }
    base.update(overrides)
    return {key: value for key, value in base.items() if value != ""}


def test_config_reads_environment() -> None:
    config = HostedConfig.from_env(_env())

    assert config.public_url == PUBLIC_URL
    assert config.allowed_hosts == (HOST,)
    assert config.cors_origins == (TRIMBLE_ORIGIN,)
    assert config.frame_ancestors == (TRIMBLE_ORIGIN,)
    assert config.issuer == ISSUER
    assert config.audience == AUDIENCE
    assert config.jwks_url == JWKS_URL
    assert config.algorithms == ("RS256",)


@pytest.mark.parametrize(
    "name",
    [
        "HERO_HOSTED_PUBLIC_URL",
        "HERO_HOSTED_ALLOWED_HOSTS",
        "HERO_TRIMBLE_ISSUER",
        "HERO_TRIMBLE_AUDIENCE",
        "HERO_TRIMBLE_JWKS_URL",
    ],
)
def test_config_requires_each_setting(name: str) -> None:
    with pytest.raises(HostedConfigError) as raised:
        HostedConfig.from_env(_env(**{name: ""}))

    assert name in str(raised.value)


@pytest.mark.parametrize(
    "overrides",
    [
        {"HERO_HOSTED_PUBLIC_URL": "http://2dhero.example.com"},
        {"HERO_TRIMBLE_JWKS_URL": "http://id.example.test/jwks.json"},
        {"HERO_TRIMBLE_ISSUER": "id.example.test"},
        {"HERO_HOSTED_CORS_ORIGINS": "*"},
        {"HERO_HOSTED_CORS_ORIGINS": "http://web.connect.trimble.com"},
        {"HERO_HOSTED_ALLOWED_HOSTS": "*"},
    ],
)
def test_config_rejects_unsafe_values(overrides: dict[str, str]) -> None:
    with pytest.raises(HostedConfigError):
        HostedConfig.from_env(_env(**overrides))


def test_config_defaults_frame_ancestors_to_trimble() -> None:
    config = HostedConfig.from_env(_env(HERO_HOSTED_CORS_ORIGINS=""))

    assert config.cors_origins == ()
    assert config.frame_ancestors == (TRIMBLE_ORIGIN,)


def test_config_error_never_contains_values() -> None:
    with pytest.raises(HostedConfigError) as raised:
        HostedConfig.from_env(_env(HERO_TRIMBLE_JWKS_URL="http://secret-host.example/jwks"))

    assert "secret-host.example" not in str(raised.value)
