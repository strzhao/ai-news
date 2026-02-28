from __future__ import annotations

import hashlib
import hmac
import os
from datetime import datetime, timedelta, timezone
from typing import Any
from urllib.parse import parse_qs, parse_qsl, quote, quote_plus, urlencode, urlparse

import requests


DEFAULT_TTL_SECONDS = 120 * 24 * 3600
TRACKING_PREFIXES = ("utm_", "spm", "fbclid", "gclid", "ref")
BOT_UA_TOKENS = (
    "bot",
    "spider",
    "crawler",
    "preview",
    "slackbot",
    "discordbot",
    "telegrambot",
    "facebookexternalhit",
    "curl",
)


def query_value(path: str, key: str) -> str:
    values = parse_qs(urlparse(path).query).get(key, [])
    return str(values[0] if values else "").strip()


def parse_bearer_token(header_value: str | None) -> str:
    raw = str(header_value or "").strip()
    if not raw:
        return ""
    parts = raw.split(" ", 1)
    if len(parts) != 2:
        return ""
    scheme, token = parts
    if scheme.strip().lower() != "bearer":
        return ""
    return token.strip()


def should_skip_tracking(method: str | None, user_agent: str | None) -> bool:
    if str(method or "").upper() == "HEAD":
        return True
    ua = str(user_agent or "").lower()
    if not ua:
        return False
    return any(token in ua for token in BOT_UA_TOKENS)


def utc_date_key(date: datetime | None = None) -> str:
    now = date or datetime.now(timezone.utc)
    return now.strftime("%Y%m%d")


def key_to_iso_date(date_key: str) -> str:
    return f"{date_key[0:4]}-{date_key[4:6]}-{date_key[6:8]}"


def last_n_date_keys(days: int) -> list[str]:
    count = max(1, min(int(days), 120))
    now = datetime.now(timezone.utc)
    return [utc_date_key(now - timedelta(days=offset)) for offset in range(count)]


def normalize_url(raw: str) -> str:
    try:
        parsed = urlparse(raw)
        if not parsed.scheme or not parsed.netloc:
            return raw
        query_pairs = parse_qsl(parsed.query, keep_blank_values=False)
        kept: list[tuple[str, str]] = []
        for key, value in query_pairs:
            lower = key.lower()
            if any(lower.startswith(prefix) for prefix in TRACKING_PREFIXES):
                continue
            kept.append((key, value))
        kept.sort(key=lambda item: item[0])
        query = urlencode(kept, doseq=True)
        path = parsed.path.rstrip("/") or "/"
        normalized = parsed._replace(
            scheme=parsed.scheme.lower(),
            netloc=parsed.netloc.lower(),
            path=path,
            params="",
            query=query,
            fragment="",
        )
        return normalized.geturl()
    except Exception:
        return raw


def canonical_query(params: dict[str, str]) -> str:
    entries = [(key, value) for key, value in params.items() if str(value).strip()]
    entries.sort(key=lambda item: item[0])
    return "&".join(f"{quote_plus(key)}={quote_plus(value)}" for key, value in entries)


def sign_params(params: dict[str, str], secret: str) -> str:
    payload = canonical_query(params).encode("utf-8")
    return hmac.new(secret.encode("utf-8"), payload, hashlib.sha256).hexdigest()


def verify_signature(params: dict[str, str], provided_sig: str, secret: str) -> bool:
    normalized_sig = str(provided_sig or "").strip()
    if len(normalized_sig) != 64:
        return False
    expected = sign_params(params, secret)
    try:
        return hmac.compare_digest(expected, normalized_sig)
    except Exception:
        return False


def hash_info_key(url: str) -> str:
    return hashlib.sha256(url.encode("utf-8")).hexdigest()[:24]


def resolve_redis_rest_url() -> str:
    return str(os.getenv("UPSTASH_REDIS_REST_URL") or os.getenv("KV_REST_API_URL") or "").strip()


def resolve_redis_rest_token() -> str:
    return str(os.getenv("UPSTASH_REDIS_REST_TOKEN") or os.getenv("KV_REST_API_TOKEN") or "").strip()


def parse_hash_result(raw: Any) -> dict[str, int]:
    if raw is None:
        return {}
    if isinstance(raw, list):
        result: dict[str, int] = {}
        for index in range(0, len(raw) - 1, 2):
            key = str(raw[index] or "").strip()
            try:
                value = int(float(raw[index + 1] or 0))
            except (TypeError, ValueError):
                continue
            if key and value > 0:
                result[key] = value
        return result
    if isinstance(raw, dict):
        result: dict[str, int] = {}
        for key, value in raw.items():
            normalized_key = str(key or "").strip()
            try:
                numeric = int(float(value or 0))
            except (TypeError, ValueError):
                continue
            if normalized_key and numeric > 0:
                result[normalized_key] = numeric
        return result
    return {}


class UpstashClient:
    def __init__(self, rest_url: str, rest_token: str, timeout_seconds: int = 10) -> None:
        self.rest_url = rest_url.rstrip("/")
        self.rest_token = rest_token
        self.timeout_seconds = timeout_seconds

    def _call(self, path: str, body: Any | None = None) -> Any:
        url = f"{self.rest_url}{path}"
        headers = {
            "Authorization": f"Bearer {self.rest_token}",
            "Content-Type": "application/json",
        }
        if body is None:
            response = requests.get(url, headers=headers, timeout=self.timeout_seconds)
        else:
            response = requests.post(url, headers=headers, json=body, timeout=self.timeout_seconds)
        if not response.ok:
            raise RuntimeError(f"Upstash error {response.status_code}: {response.text}")
        return response.json()

    def hincrby(self, key: str, field: str, increment: int = 1) -> None:
        self._call(f"/hincrby/{quote(key, safe='')}/{quote(field, safe='')}/{int(increment)}")

    def expire(self, key: str, ttl_seconds: int = DEFAULT_TTL_SECONDS) -> None:
        self._call(f"/expire/{quote(key, safe='')}/{int(ttl_seconds)}")

    def pipeline(self, commands: list[list[str | int]]) -> list[Any]:
        if not commands:
            return []
        result = self._call("/pipeline", commands)
        if not isinstance(result, list):
            raise RuntimeError("Upstash pipeline result must be an array")
        return result


def build_upstash_client_or_none() -> UpstashClient | None:
    url = resolve_redis_rest_url()
    token = resolve_redis_rest_token()
    if not url or not token:
        return None
    return UpstashClient(url, token)


def build_upstash_client() -> UpstashClient:
    client = build_upstash_client_or_none()
    if not client:
        raise RuntimeError("Missing Upstash credentials")
    return client
