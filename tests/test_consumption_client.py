from __future__ import annotations

import pytest

from src.personalization.consumption_client import ConsumptionClient, ConsumptionClientError


class _MockResponse:
    def __init__(self, payload: dict, status_code: int = 200) -> None:
        self._payload = payload
        self.status_code = status_code

    def raise_for_status(self) -> None:
        if self.status_code >= 400:
            raise RuntimeError("bad response")

    def json(self) -> dict:
        return self._payload


def test_consumption_client_parses_source_daily_clicks(monkeypatch: pytest.MonkeyPatch) -> None:
    payload = {
        "rows": [
            {"source_id": "s1", "date": "2026-02-27", "clicks": 3},
            {"source_id": "s1", "date": "2026-02-27", "clicks": 2},
            {"source_id": "s2", "date": "2026-02-26", "clicks": 1},
        ]
    }
    monkeypatch.setattr(
        "src.personalization.consumption_client.requests.get",
        lambda *args, **kwargs: _MockResponse(payload),
    )
    client = ConsumptionClient(base_url="https://tracker.example.com", api_token="token")
    result = client.fetch_source_daily_clicks(days=90)
    assert result["s1"]["2026-02-27"] == 5
    assert result["s2"]["2026-02-26"] == 1


def test_consumption_client_validates_rows_shape() -> None:
    with pytest.raises(ConsumptionClientError):
        ConsumptionClient._parse_source_daily_payload({"rows": "invalid"})

