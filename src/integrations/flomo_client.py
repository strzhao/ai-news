from __future__ import annotations

import logging
import os
import time

import requests

from src.models import FlomoPayload

LOGGER = logging.getLogger(__name__)


class FlomoSyncError(RuntimeError):
    pass


class FlomoClient:
    def __init__(
        self,
        api_url: str | None = None,
        timeout_seconds: int = 20,
        max_retries: int = 3,
    ) -> None:
        self.api_url = api_url or os.getenv("FLOMO_API_URL")
        self.timeout_seconds = timeout_seconds
        self.max_retries = max_retries

        if not self.api_url:
            raise FlomoSyncError("Missing FLOMO_API_URL")

    def send(self, payload: FlomoPayload) -> None:
        headers = {"Content-Type": "application/json"}
        body = {"content": payload.content}

        backoff_seconds = 1.0
        last_error: Exception | None = None
        for attempt in range(1, self.max_retries + 1):
            try:
                response = requests.post(
                    self.api_url,
                    headers=headers,
                    json=body,
                    timeout=self.timeout_seconds,
                )
                if response.status_code in (408, 429, 500, 502, 503, 504):
                    raise FlomoSyncError(f"temporary error ({response.status_code}): {response.text}")
                response.raise_for_status()
                LOGGER.info("Flomo sync success: status=%s", response.status_code)
                return
            except (requests.RequestException, FlomoSyncError) as exc:
                last_error = exc
                LOGGER.warning("Flomo sync failed on attempt %s/%s: %s", attempt, self.max_retries, exc)
                if attempt < self.max_retries:
                    time.sleep(backoff_seconds)
                    backoff_seconds *= 2

        raise FlomoSyncError(f"Flomo sync failed after retries: {last_error}")
