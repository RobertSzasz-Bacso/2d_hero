import re

KEY_SHAPED = re.compile(r"sk-|crsr_|cursor_api_key", re.IGNORECASE)


def test_settings_placeholder_has_no_key(client, token: str) -> None:
    response = client.get("/api/settings", headers={"X-Hero-Token": token})

    assert response.status_code == 200
    body = response.json()
    assert body == {"cursorKeySet": False}
    assert token not in response.text
    assert KEY_SHAPED.search(response.text) is None
    assert _string_values(body) == []


def _string_values(value: object) -> list[str]:
    found: list[str] = []
    if isinstance(value, str):
        found.append(value)
    elif isinstance(value, dict):
        for item in value.values():
            found.extend(_string_values(item))
    elif isinstance(value, list):
        for item in value:
            found.extend(_string_values(item))
    return found
