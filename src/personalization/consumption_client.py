from __future__ import annotations

import logging
import os
from collections import defaultdict
from typing import Any

import requests


LOGGER = logging.getLogger(__name__)


class ConsumptionClientError(RuntimeError):
    pass


class ConsumptionClient:
    def __init__(
        self,
        base_url: str | None = None,
        api_token: str | None = None,
        timeout_seconds: int = 10,
    ) -> None:
        self.base_url = (base_url or os.getenv("TRACKER_BASE_URL", "")).strip().rstrip("/")
        self.api_token = (api_token or os.getenv("TRACKER_API_TOKEN", "")).strip()
        self.timeout_seconds = timeout_seconds

    def enabled(self) -> bool:
        return bool(self.base_url and self.api_token)

    def fetch_source_daily_clicks(self, days: int = 90) -> dict[str, dict[str, int]]:
        if not self.enabled():
            return {}

        query_days = max(1, min(int(days), 120))
        url = f"{self.base_url}/api/stats/sources"
        headers = {"Authorization": f"Bearer {self.api_token}"}
        params = {"days": str(query_days)}

        try:
            response = requests.get(url, headers=headers, params=params, timeout=self.timeout_seconds)
            response.raise_for_status()
            payload = response.json()
        except requests.RequestException as exc:
            raise ConsumptionClientError(f"Failed to fetch source stats: {exc}") from exc
        except ValueError as exc:
            raise ConsumptionClientError(f"Invalid source stats payload: {exc}") from exc

        return self._parse_source_daily_payload(payload)

    def fetch_type_daily_clicks(self, days: int = 90) -> dict[str, dict[str, int]]:
        if not self.enabled():
            return {}

        query_days = max(1, min(int(days), 120))
        url = f"{self.base_url}/api/stats/types"
        headers = {"Authorization": f"Bearer {self.api_token}"}
        params = {"days": str(query_days)}

        try:
            response = requests.get(url, headers=headers, params=params, timeout=self.timeout_seconds)
            response.raise_for_status()
            payload = response.json()
        except requests.RequestException as exc:
            raise ConsumptionClientError(f"Failed to fetch type stats: {exc}") from exc
        except ValueError as exc:
            raise ConsumptionClientError(f"Invalid type stats payload: {exc}") from exc

        return self._parse_type_daily_payload(payload)

    @staticmethod
    def _parse_source_daily_payload(payload: Any) -> dict[str, dict[str, int]]:
        if not isinstance(payload, dict):
            raise ConsumptionClientError("Source stats payload must be an object")
        rows = payload.get("rows", [])
        if not isinstance(rows, list):
            raise ConsumptionClientError("Source stats payload.rows must be a list")

        source_daily: dict[str, dict[str, int]] = defaultdict(dict)
        for row in rows:
            if not isinstance(row, dict):
                continue
            source_id = str(row.get("source_id", "")).strip()
            date = str(row.get("date", "")).strip()
            raw_clicks = row.get("clicks", 0)
            if not source_id or not date:
                continue
            try:
                clicks = max(0, int(raw_clicks))
            except (TypeError, ValueError):
                continue
            if clicks <= 0:
                continue
            existing = source_daily[source_id].get(date, 0)
            source_daily[source_id][date] = existing + clicks
        return dict(source_daily)

    @staticmethod
    def _parse_type_daily_payload(payload: Any) -> dict[str, dict[str, int]]:
        if not isinstance(payload, dict):
            raise ConsumptionClientError("Type stats payload must be an object")
        rows = payload.get("rows", [])
        if not isinstance(rows, list):
            raise ConsumptionClientError("Type stats payload.rows must be a list")

        type_daily: dict[str, dict[str, int]] = defaultdict(dict)
        for row in rows:
            if not isinstance(row, dict):
                continue
            primary_type = str(row.get("primary_type", "")).strip()
            date = str(row.get("date", "")).strip()
            raw_clicks = row.get("clicks", 0)
            if not primary_type or not date:
                continue
            try:
                clicks = max(0, int(raw_clicks))
            except (TypeError, ValueError):
                continue
            if clicks <= 0:
                continue
            existing = type_daily[primary_type].get(date, 0)
            type_daily[primary_type][date] = existing + clicks
        return dict(type_daily)


def load_source_daily_clicks(days: int = 90) -> dict[str, dict[str, int]]:
    client = ConsumptionClient()
    if not client.enabled():
        LOGGER.info("Tracker disabled: TRACKER_BASE_URL or TRACKER_API_TOKEN is missing")
        return {}
    return client.fetch_source_daily_clicks(days=days)


def load_type_daily_clicks(days: int = 90) -> dict[str, dict[str, int]]:
    client = ConsumptionClient()
    if not client.enabled():
        LOGGER.info("Tracker disabled: TRACKER_BASE_URL or TRACKER_API_TOKEN is missing")
        return {}
    return client.fetch_type_daily_clicks(days=days)
