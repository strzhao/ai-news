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
        api_token: str | None = None,
        token_header: str | None = None,
        token_prefix: str | None = None,
        content_field: str | None = None,
        dedupe_field: str | None = None,
        timeout_seconds: int = 20,
        max_retries: int = 3,
    ) -> None:
        self.api_url = api_url or os.getenv("FLOMO_API_URL")
        self.api_token = api_token or os.getenv("FLOMO_API_TOKEN")
        self.token_header = token_header or os.getenv("FLOMO_TOKEN_HEADER", "Authorization")
        self.token_prefix = token_prefix or os.getenv("FLOMO_TOKEN_PREFIX", "Bearer")
        self.content_field = content_field or os.getenv("FLOMO_CONTENT_FIELD", "content")
        self.dedupe_field = dedupe_field if dedupe_field is not None else os.getenv("FLOMO_DEDUPE_FIELD", "")
        self.timeout_seconds = timeout_seconds
        self.max_retries = max_retries

        if not self.api_url:
            raise FlomoSyncError("Missing FLOMO_API_URL")

    def send(self, payload: FlomoPayload) -> None:
        headers = {"Content-Type": "application/json"}
        if self.api_token:
            token_value = f"{self.token_prefix} {self.api_token}".strip()
            headers[self.token_header] = token_value

        body = {self.content_field: payload.content}
        if self.dedupe_field:
            body[self.dedupe_field] = payload.dedupe_key

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
