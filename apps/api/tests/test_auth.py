from fastapi.testclient import TestClient

from hero.app import create_app


def test_settings_without_token_is_401(client) -> None:
    response = client.get("/api/settings")

    assert response.status_code == 401
    assert response.json()["detail"]


def test_unknown_route_without_token_is_401(client) -> None:
    response = client.get("/api/not-a-route")

    assert response.status_code == 401


def test_post_health_without_token_is_401(client) -> None:
    response = client.post("/api/health")

    assert response.status_code == 401


def test_wrong_token_is_401(client) -> None:
    response = client.get("/api/settings", headers={"X-Hero-Token": "not-the-token"})

    assert response.status_code == 401


def test_foreign_host_is_400() -> None:
    app = create_app(token="phase1-test-token")
    with TestClient(app, base_url="http://evil.example") as foreign:
        health = foreign.get("/api/health")
        settings = foreign.get(
            "/api/settings",
            headers={"X-Hero-Token": "phase1-test-token"},
        )

    assert health.status_code == 400
    assert settings.status_code == 400
    assert health.json()["detail"]


def test_unknown_route_with_token_is_404(client, token: str) -> None:
    response = client.get("/api/not-a-route", headers={"X-Hero-Token": token})

    assert response.status_code == 404
    assert "detail" in response.json()
