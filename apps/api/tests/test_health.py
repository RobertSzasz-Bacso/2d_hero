def test_health_returns_200_without_token(client) -> None:
    response = client.get("/api/health")

    assert response.status_code == 200
    assert response.json() == {"ok": True}


def test_health_allows_localhost_with_port() -> None:
    from fastapi.testclient import TestClient

    from hero.app import create_app

    app = create_app(token="phase1-test-token")
    with TestClient(app, base_url="http://localhost:5173") as local_client:
        response = local_client.get("/api/health")

    assert response.status_code == 200
    assert response.json() == {"ok": True}
