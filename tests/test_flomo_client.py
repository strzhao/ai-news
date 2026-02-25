from __future__ import annotations

from types import SimpleNamespace

from src.integrations.flomo_client import FlomoClient
from src.models import FlomoPayload


def test_flomo_webhook_payload_without_dedupe(monkeypatch):
    captured = {}

    def _fake_post(url, headers, json, timeout):  # noqa: ANN001
        captured["url"] = url
        captured["headers"] = headers
        captured["json"] = json
        captured["timeout"] = timeout

        response = SimpleNamespace(status_code=200, text="ok")
        response.raise_for_status = lambda: None
        return response

    monkeypatch.setattr("requests.post", _fake_post)
    client = FlomoClient(
        api_url="https://flomoapp.com/iwh/demo",
        api_token=None,
        dedupe_field="",
        content_field="content",
    )
    client.send(FlomoPayload(content="Hello, #flomo", dedupe_key="digest-2026-02-26"))

    assert captured["json"] == {"content": "Hello, #flomo"}
    assert captured["headers"]["Content-Type"] == "application/json"
