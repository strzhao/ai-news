from __future__ import annotations

import json
import os
from http.server import BaseHTTPRequestHandler

from api._tracker_common import (
    build_upstash_client_or_none,
    hash_info_key,
    normalize_url,
    query_value,
    should_skip_tracking,
    utc_date_key,
    verify_signature,
)


def _signed_params(request: BaseHTTPRequestHandler) -> dict[str, str]:
    return {
        "u": query_value(request.path, "u"),
        "sid": query_value(request.path, "sid"),
        "aid": query_value(request.path, "aid"),
        "d": query_value(request.path, "d"),
        "ch": query_value(request.path, "ch"),
        "pt": query_value(request.path, "pt"),
    }


def _respond_json(request: BaseHTTPRequestHandler, status: int, payload: dict[str, object]) -> None:
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    request.send_response(status)
    request.send_header("Content-Type", "application/json; charset=utf-8")
    request.send_header("Content-Length", str(len(body)))
    request.end_headers()
    request.wfile.write(body)


def _redirect(request: BaseHTTPRequestHandler, target_url: str) -> None:
    request.send_response(302)
    request.send_header("Location", target_url)
    request.end_headers()


def _track_click(params: dict[str, str], user_agent: str | None) -> None:
    upstash = build_upstash_client_or_none()
    if not upstash:
        return

    date_key = utc_date_key()
    source_key = f"clicks:source:{date_key}"
    article_key = f"clicks:article:{date_key}"
    meta_key = f"clicks:meta:{date_key}"
    article_info_key = hash_info_key(normalize_url(params["u"]))

    upstash.hincrby(source_key, params["sid"], 1)
    upstash.expire(source_key)
    upstash.hincrby(article_key, article_info_key, 1)
    upstash.expire(article_key)
    upstash.hincrby(meta_key, "total", 1)
    upstash.expire(meta_key)

    primary_type = str(params.get("pt") or "").strip()
    if primary_type:
        type_key = f"clicks:type:{date_key}"
        upstash.hincrby(type_key, primary_type, 1)
        upstash.expire(type_key)


class handler(BaseHTTPRequestHandler):
    def do_GET(self) -> None:  # noqa: N802
        secret = str(os.getenv("TRACKER_SIGNING_SECRET") or "").strip()
        if not secret:
            _respond_json(self, 500, {"error": "Missing TRACKER_SIGNING_SECRET"})
            return

        params = _signed_params(self)
        signature = query_value(self.path, "sig")
        required_keys = ("u", "sid", "aid", "d", "ch")
        if any(not str(params[key]).strip() for key in required_keys):
            _respond_json(self, 400, {"error": "Missing required query params"})
            return

        try:
            # Validate URL early to avoid open redirect abuse.
            if not params["u"].strip():
                raise ValueError("empty")
            parsed = normalize_url(params["u"])
            if not parsed.startswith("http://") and not parsed.startswith("https://"):
                raise ValueError("invalid")
        except Exception:
            _respond_json(self, 400, {"error": "Invalid target URL"})
            return

        legacy_params = {
            "u": params["u"],
            "sid": params["sid"],
            "aid": params["aid"],
            "d": params["d"],
            "ch": params["ch"],
        }
        if not verify_signature(params, signature, secret) and not verify_signature(legacy_params, signature, secret):
            upstash = build_upstash_client_or_none()
            if upstash:
                try:
                    meta_key = f"clicks:meta:{utc_date_key()}"
                    upstash.hincrby(meta_key, "invalid_sig", 1)
                    upstash.expire(meta_key)
                except Exception:
                    pass
            _respond_json(self, 400, {"error": "Invalid signature"})
            return

        user_agent = str(self.headers.get("user-agent") or "")
        if should_skip_tracking("GET", user_agent):
            _redirect(self, params["u"])
            return

        try:
            _track_click(params, user_agent)
        except Exception:
            # Tracking failures should never block redirect.
            pass

        _redirect(self, params["u"])
