"""Phase 22: POST /api/projects/from-url streams a Trimble download URL into a new project.

Only the network is faked (an httpx transport and the DNS lookup). The route, the URL checks,
the download, and the project store are the real code.
"""

import asyncio
import hashlib
import json
import logging
import threading
import time
from collections.abc import AsyncIterator, Callable, Iterator
from pathlib import Path
from typing import Any, cast

import httpx
import jwt
import laspy
import numpy as np
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi.testclient import TestClient

from hero.app import create_app
from hero.hosted import HostedConfig
from hero.jobs import execute_import
from hero.testkit.building import build_building

HOST = "2dhero.example.com"
PUBLIC_URL = f"https://{HOST}"
ISSUER = "https://id.example.test"
AUDIENCE = "2d-hero-client-id"
JWKS_URL = "https://id.example.test/jwks.json"
LOCAL_TOKEN = "local-session-token-for-from-url-tests"
DOWNLOAD_HOST = "files.example-cdn.test"
SIGNATURE = "SECRETSIG123abcDEF"
URL = f"https://{DOWNLOAD_HOST}/blobs/scan?X-Amz-Signature={SIGNATURE}&Expires=999"
MAX_BYTES = 8 * 1024 * 1024
FIVE_MB = 5 * 1024 * 1024

Resolver = Callable[[str], list[str]]
Handler = Callable[[httpx.Request], httpx.Response]


@pytest.fixture(scope="module")
def signing_key() -> rsa.RSAPrivateKey:
    return rsa.generate_private_key(public_exponent=65537, key_size=2048)


@pytest.fixture(scope="module")
def las_bytes(tmp_path_factory: pytest.TempPathFactory) -> bytes:
    """A LAS of at least 5 MB: the synthetic building, repeated with seeded jitter."""
    building = build_building(1)
    rng = np.random.default_rng(22)
    base = building.vertices
    count = FIVE_MB // 20 + 4096
    picks = rng.integers(0, len(base), size=count)
    points = base[picks] + rng.normal(0.0, 0.002, size=(count, 3))
    header = laspy.LasHeader(point_format=0, version="1.2")
    header.scales = np.array([0.001, 0.001, 0.001])
    header.offsets = points.min(axis=0)
    cloud = laspy.LasData(header)
    cloud.x = points[:, 0]
    cloud.y = points[:, 1]
    cloud.z = points[:, 2]
    path = tmp_path_factory.mktemp("las") / "scan.las"
    cast(Any, cloud).write(path)
    data = path.read_bytes()
    assert len(data) >= FIVE_MB
    return data


def make_token(key: rsa.RSAPrivateKey) -> str:
    now = int(time.time())
    return jwt.encode(
        {"iss": ISSUER, "aud": AUDIENCE, "sub": "user-1", "iat": now, "exp": now + 600},
        key,
        algorithm="RS256",
    )


def bearer(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def public_resolver(_host: str) -> list[str]:
    return ["93.184.216.34"]


def config(max_bytes: int = MAX_BYTES, hosts: tuple[str, ...] = (DOWNLOAD_HOST,)) -> HostedConfig:
    return HostedConfig(
        public_url=PUBLIC_URL,
        allowed_hosts=(HOST,),
        cors_origins=(),
        frame_ancestors=("https://web.connect.trimble.com",),
        issuer=ISSUER,
        audience=AUDIENCE,
        jwks_url=JWKS_URL,
        download_hosts=hosts,
        max_download_bytes=max_bytes,
    )


def build(
    tmp_path: Path,
    signing_key: rsa.RSAPrivateKey,
    handler: Handler,
    *,
    max_bytes: int = MAX_BYTES,
    hosts: tuple[str, ...] = (DOWNLOAD_HOST,),
    resolver: Resolver = public_resolver,
) -> TestClient:
    app = create_app(
        token=LOCAL_TOKEN,
        config_dir=tmp_path / "config",
        projects_dir=tmp_path / "projects",
        hosted=config(max_bytes, hosts),
        key_provider=lambda _token: signing_key.public_key(),
        download_transport=httpx.MockTransport(handler),
        resolver=resolver,
    )
    return TestClient(app, base_url=PUBLIC_URL)


def serve(data: bytes, seen: list[httpx.Request] | None = None) -> Handler:
    def handler(request: httpx.Request) -> httpx.Response:
        if seen is not None:
            seen.append(request)
        return httpx.Response(200, content=data, headers={"Content-Type": "application/x-las"})

    return handler


def body(url: str = URL, **extra: object) -> dict[str, object]:
    payload: dict[str, object] = {
        "url": url,
        "fileName": "Level 1 scan.las",
        "fileId": "file-123",
        "versionId": "ver-9",
    }
    payload.update(extra)
    return payload


@pytest.fixture
def hosted(
    tmp_path: Path, signing_key: rsa.RSAPrivateKey, las_bytes: bytes
) -> Iterator[TestClient]:
    with build(tmp_path, signing_key, serve(las_bytes)) as client:
        yield client


def project_folders(tmp_path: Path) -> list[Path]:
    root = tmp_path / "projects"
    return sorted(path for path in root.iterdir()) if root.is_dir() else []


# --- availability ---------------------------------------------------------


def test_local_mode_returns_404(client, token: str) -> None:
    response = client.post(
        "/api/projects/from-url", json=body(), headers={"X-Hero-Token": token}
    )

    assert response.status_code == 404


def test_hosted_mode_without_bearer_is_401(hosted: TestClient) -> None:
    response = hosted.post("/api/projects/from-url", json=body())

    assert response.status_code == 401


# --- rejected URLs --------------------------------------------------------


def redirect_to(location: str) -> Handler:
    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(302, headers={"Location": location})

    return handler


@pytest.mark.parametrize(
    ("name", "payload", "handler", "hosts", "resolver"),
    [
        (
            "http",
            body(f"http://{DOWNLOAD_HOST}/blobs/scan?sig={SIGNATURE}"),
            None,
            (DOWNLOAD_HOST,),
            public_resolver,
        ),
        (
            "host-not-on-allow-list",
            body(f"https://evil.example/blobs/scan?sig={SIGNATURE}"),
            None,
            (DOWNLOAD_HOST,),
            public_resolver,
        ),
        (
            "no-allow-list",
            body(),
            None,
            (),
            public_resolver,
        ),
        (
            "redirect-to-another-host",
            body(),
            redirect_to(f"https://evil.example/stolen?sig={SIGNATURE}"),
            (DOWNLOAD_HOST,),
            public_resolver,
        ),
        (
            "redirect-to-http",
            body(),
            redirect_to(f"http://{DOWNLOAD_HOST}/plain?sig={SIGNATURE}"),
            (DOWNLOAD_HOST,),
            public_resolver,
        ),
        (
            "private-address",
            body(),
            None,
            (DOWNLOAD_HOST,),
            lambda _host: ["10.0.0.5"],
        ),
        (
            "private-address-among-public",
            body(),
            None,
            (DOWNLOAD_HOST,),
            lambda _host: ["93.184.216.34", "192.168.1.20"],
        ),
        (
            "loopback-resolution",
            body(),
            None,
            (DOWNLOAD_HOST,),
            lambda _host: ["127.0.0.1"],
        ),
        (
            "loopback-literal",
            body(f"https://127.0.0.1/blobs/scan?sig={SIGNATURE}"),
            None,
            ("127.0.0.1",),
            public_resolver,
        ),
        (
            "ipv6-loopback-literal",
            body(f"https://[::1]/blobs/scan?sig={SIGNATURE}"),
            None,
            ("::1",),
            public_resolver,
        ),
        (
            "credentials-in-url",
            body(f"https://user:pass@{DOWNLOAD_HOST}/blobs/scan?sig={SIGNATURE}"),
            None,
            (DOWNLOAD_HOST,),
            public_resolver,
        ),
        (
            "unsupported-extension",
            body(fileName="notes.pdf"),
            None,
            (DOWNLOAD_HOST,),
            public_resolver,
        ),
        (
            "no-extension",
            body(fileName="scan"),
            None,
            (DOWNLOAD_HOST,),
            public_resolver,
        ),
    ],
)
def test_rejected_requests_are_400_and_leave_nothing(
    tmp_path: Path,
    signing_key: rsa.RSAPrivateKey,
    caplog: pytest.LogCaptureFixture,
    name: str,
    payload: dict[str, object],
    handler: Handler | None,
    hosts: tuple[str, ...],
    resolver: Resolver,
) -> None:
    reached: list[httpx.Request] = []

    def default(request: httpx.Request) -> httpx.Response:
        reached.append(request)
        return httpx.Response(200, content=b"data")

    chosen = handler if handler is not None else default
    with build(tmp_path, signing_key, chosen, hosts=hosts, resolver=resolver) as client:
        with caplog.at_level(logging.DEBUG):
            response = client.post(
                "/api/projects/from-url", json=payload, headers=bearer(make_token(signing_key))
            )

    assert response.status_code == 400, name
    assert SIGNATURE not in response.text
    assert SIGNATURE not in "\n".join(record.getMessage() for record in caplog.records)
    assert project_folders(tmp_path) == []
    if handler is None:
        assert reached == [], name


def test_malformed_body_is_422(hosted: TestClient, signing_key: rsa.RSAPrivateKey) -> None:
    response = hosted.post(
        "/api/projects/from-url", json={"url": URL}, headers=bearer(make_token(signing_key))
    )

    assert response.status_code == 422


# --- a good download ------------------------------------------------------


def test_five_megabyte_las_becomes_a_project_that_imports(
    tmp_path: Path, signing_key: rsa.RSAPrivateKey, las_bytes: bytes
) -> None:
    seen: list[httpx.Request] = []
    token = make_token(signing_key)
    with build(tmp_path, signing_key, serve(las_bytes, seen)) as client:
        response = client.post(
            "/api/projects/from-url",
            json=body(name="Level 1"),
            headers=bearer(token),
        )

        assert response.status_code == 200, response.text
        project = response.json()
        fetched = client.get(f"/api/projects/{project['id']}", headers=bearer(token))
        assert fetched.status_code == 200

    folder = tmp_path / "projects" / project["id"]
    stored = (folder / "source.las").read_bytes()
    assert len(stored) >= FIVE_MB
    assert hashlib.sha256(stored).hexdigest() == hashlib.sha256(las_bytes).hexdigest()
    assert list(folder.glob("*.part")) == []

    meta = json.loads((folder / "project.json").read_text(encoding="utf-8"))
    assert meta["name"] == "Level 1"
    assert meta["sourceFileName"] == "Level 1 scan.las"
    assert meta["linkedPath"] is None
    assert meta["trimbleSource"] == {
        "fileId": "file-123",
        "versionId": "ver-9",
        "name": "Level 1 scan.las",
    }
    assert SIGNATURE not in json.dumps(meta)

    assert len(seen) == 1
    assert "authorization" not in seen[0].headers
    assert "cookie" not in seen[0].headers
    assert seen[0].url.host == DOWNLOAD_HOST

    outcome = execute_import(str(folder), "auto", "auto")
    assert outcome["state"] == "done"


def test_same_host_redirect_is_followed(
    tmp_path: Path, signing_key: rsa.RSAPrivateKey, las_bytes: bytes
) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/blobs/scan":
            return httpx.Response(302, headers={"Location": "/blobs/final?part=2"})
        return httpx.Response(200, content=las_bytes)

    with build(tmp_path, signing_key, handler) as client:
        response = client.post(
            "/api/projects/from-url", json=body(), headers=bearer(make_token(signing_key))
        )

    assert response.status_code == 200, response.text


# --- failures leave nothing -----------------------------------------------


def test_failed_download_leaves_no_file_and_no_project(
    tmp_path: Path, signing_key: rsa.RSAPrivateKey, las_bytes: bytes
) -> None:
    async def broken() -> AsyncIterator[bytes]:
        yield las_bytes[: 1024 * 1024]
        raise httpx.ReadError("connection dropped")

    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, content=broken())

    with build(tmp_path, signing_key, handler) as client:
        token = make_token(signing_key)
        response = client.post("/api/projects/from-url", json=body(), headers=bearer(token))
        listed = client.get("/api/projects", headers=bearer(token))

    assert response.status_code == 502
    assert SIGNATURE not in response.text
    assert listed.json() == []
    assert project_folders(tmp_path) == []


def test_remote_error_status_is_502(tmp_path: Path, signing_key: rsa.RSAPrivateKey) -> None:
    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(403, content=b"<Error>expired</Error>")

    with build(tmp_path, signing_key, handler) as client:
        response = client.post(
            "/api/projects/from-url", json=body(), headers=bearer(make_token(signing_key))
        )

    assert response.status_code == 502
    assert project_folders(tmp_path) == []


def test_cancelled_download_leaves_no_file_and_no_project(
    tmp_path: Path, signing_key: rsa.RSAPrivateKey, las_bytes: bytes
) -> None:
    started = threading.Event()
    transfer = "a" * 32

    async def slow() -> AsyncIterator[bytes]:
        offset = 0
        for _ in range(400):
            yield las_bytes[offset : offset + 65536]
            offset += 65536
            if offset >= 3 * 65536:
                started.set()
            await asyncio.sleep(0.01)

    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, content=slow())

    token = make_token(signing_key)
    result: dict[str, Any] = {}
    with build(tmp_path, signing_key, handler) as client:

        def post() -> None:
            result["post"] = client.post(
                "/api/projects/from-url",
                json=body(transferId=transfer),
                headers=bearer(token),
            )

        worker = threading.Thread(target=post)
        worker.start()
        assert started.wait(10)
        progress = client.get(f"/api/transfers/{transfer}", headers=bearer(token))
        assert progress.status_code == 200
        assert progress.json()["state"] == "running"
        assert progress.json()["bytes"] > 0
        cancel = client.post(f"/api/transfers/{transfer}/cancel", headers=bearer(token))
        assert cancel.status_code == 200
        worker.join(15)
        assert not worker.is_alive()
        gone = client.get(f"/api/transfers/{transfer}", headers=bearer(token))

    assert result["post"].status_code == 409
    assert gone.status_code == 404
    assert project_folders(tmp_path) == []


def test_unknown_transfer_is_404(hosted: TestClient, signing_key: rsa.RSAPrivateKey) -> None:
    headers = bearer(make_token(signing_key))

    assert hosted.get(f"/api/transfers/{'b' * 32}", headers=headers).status_code == 404
    assert hosted.post(f"/api/transfers/{'b' * 32}/cancel", headers=headers).status_code == 404


def test_transfer_routes_are_404_in_local_mode(client, token: str) -> None:
    headers = {"X-Hero-Token": token}

    assert client.get(f"/api/transfers/{'c' * 32}", headers=headers).status_code == 404
    assert client.post(f"/api/transfers/{'c' * 32}/cancel", headers=headers).status_code == 404


# --- size limit -----------------------------------------------------------


def test_declared_size_over_the_limit_is_413_and_not_read(
    tmp_path: Path, signing_key: rsa.RSAPrivateKey
) -> None:
    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200, content=b"x" * 2048, headers={"Content-Length": str(MAX_BYTES + 1)}
        )

    with build(tmp_path, signing_key, handler) as client:
        response = client.post(
            "/api/projects/from-url", json=body(), headers=bearer(make_token(signing_key))
        )

    assert response.status_code == 413
    assert project_folders(tmp_path) == []


def test_streamed_size_over_the_limit_is_413_and_removed(
    tmp_path: Path, signing_key: rsa.RSAPrivateKey, las_bytes: bytes
) -> None:
    async def endless() -> AsyncIterator[bytes]:
        for offset in range(0, len(las_bytes), 65536):
            yield las_bytes[offset : offset + 65536]

    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, content=endless())

    with build(tmp_path, signing_key, handler, max_bytes=2 * 1024 * 1024) as client:
        response = client.post(
            "/api/projects/from-url", json=body(), headers=bearer(make_token(signing_key))
        )

    assert response.status_code == 413
    assert project_folders(tmp_path) == []
    leftovers = [path for path in tmp_path.rglob("*") if path.is_file() and path.suffix == ".part"]
    assert leftovers == []


def test_local_copy_limit_is_unchanged() -> None:
    from hero.projects import MAX_COPY_BYTES

    assert MAX_COPY_BYTES == 200 * 1024 * 1024


# --- secrets --------------------------------------------------------------


def test_url_query_and_bearer_never_reach_logs_responses_or_disk(
    tmp_path: Path,
    signing_key: rsa.RSAPrivateKey,
    las_bytes: bytes,
    caplog: pytest.LogCaptureFixture,
) -> None:
    token = make_token(signing_key)
    signature = token.rsplit(".", 1)[1]
    bodies: list[str] = []

    def flaky(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/blobs/missing":
            return httpx.Response(404, content=b"gone")
        return httpx.Response(200, content=las_bytes)

    with build(tmp_path, signing_key, flaky) as client:
        with caplog.at_level(logging.DEBUG):
            for url in (
                URL,
                f"https://{DOWNLOAD_HOST}/blobs/missing?X-Amz-Signature={SIGNATURE}",
                f"http://{DOWNLOAD_HOST}/blobs/scan?X-Amz-Signature={SIGNATURE}",
                f"https://evil.example/x?X-Amz-Signature={SIGNATURE}",
            ):
                response = client.post(
                    "/api/projects/from-url", json=body(url), headers=bearer(token)
                )
                bodies.append(response.text)
                bodies.append(str(dict(response.headers)))
            listing = client.get("/api/projects", headers=bearer(token))
            bodies.append(listing.text)

    logged = "\n".join(record.getMessage() for record in caplog.records)
    logged += "\n".join(str(record.__dict__) for record in caplog.records)
    for secret in (SIGNATURE, "X-Amz-Signature", token, signature):
        assert secret not in logged
        for text in bodies:
            assert secret not in text
        for path in tmp_path.rglob("*"):
            if path.is_file() and path.stat().st_size < 1_000_000:
                assert secret.encode() not in path.read_bytes(), path
