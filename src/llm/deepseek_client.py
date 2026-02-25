from __future__ import annotations

import json
import os
import re
from typing import Any

import requests


class DeepSeekError(RuntimeError):
    pass


class DeepSeekClient:
    def __init__(
        self,
        api_key: str | None = None,
        model: str | None = None,
        base_url: str | None = None,
        timeout_seconds: int = 45,
    ) -> None:
        self.api_key = api_key or os.getenv("DEEPSEEK_API_KEY")
        self.model = model or os.getenv("DEEPSEEK_MODEL", "deepseek-chat")
        self.base_url = (base_url or os.getenv("DEEPSEEK_BASE_URL") or "https://api.deepseek.com").rstrip("/")
        self.timeout_seconds = timeout_seconds

        if not self.api_key:
            raise DeepSeekError("Missing DEEPSEEK_API_KEY")

    def chat(self, messages: list[dict[str, str]], temperature: float = 0.2) -> str:
        url = f"{self.base_url}/chat/completions"
        payload = {
            "model": self.model,
            "messages": messages,
            "temperature": temperature,
        }
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }

        try:
            response = requests.post(
                url,
                headers=headers,
                json=payload,
                timeout=self.timeout_seconds,
            )
            response.raise_for_status()
        except requests.RequestException as exc:
            raise DeepSeekError(f"DeepSeek request failed: {exc}") from exc

        data = response.json()
        try:
            return data["choices"][0]["message"]["content"]
        except (KeyError, IndexError, TypeError) as exc:
            raise DeepSeekError(f"Unexpected DeepSeek response: {data}") from exc

    def chat_json(self, messages: list[dict[str, str]], temperature: float = 0.2) -> dict[str, Any]:
        raw = self.chat(messages, temperature=temperature)
        cleaned = _extract_json_payload(raw)
        try:
            return json.loads(cleaned)
        except json.JSONDecodeError as exc:
            raise DeepSeekError(f"Model output is not valid JSON: {raw}") from exc


def _extract_json_payload(raw: str) -> str:
    text = raw.strip()
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?", "", text).strip()
        text = re.sub(r"```$", "", text).strip()
    return text
