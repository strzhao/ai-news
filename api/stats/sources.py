from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler

from api._tracker_common import (
    build_upstash_client,
    key_to_iso_date,
    last_n_date_keys,
    parse_bearer_token,
    parse_hash_result,
    query_value,
)


def _respond_json(request: BaseHTTPRequestHandler, status: int, payload: dict[str, object]) -> None:
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    request.send_response(status)
    request.send_header("Content-Type", "application/json; charset=utf-8")
    request.send_header("Content-Length", str(len(body)))
    request.end_headers()
    request.wfile.write(body)


class handler(BaseHTTPRequestHandler):
    def do_GET(self) -> None:  # noqa: N802
        expected_token = str(os.getenv("TRACKER_API_TOKEN") or "").strip()
        provided_token = parse_bearer_token(self.headers.get("authorization"))
        if not expected_token or provided_token != expected_token:
            _respond_json(self, 401, {"error": "Unauthorized"})
            return

        raw_days = query_value(self.path, "days") or "90"
        try:
            days = max(1, min(int(raw_days), 120))
        except ValueError:
            days = 90

        try:
            upstash = build_upstash_client()
        except Exception as exc:  # noqa: BLE001
            _respond_json(self, 500, {"error": str(exc)})
            return

        date_keys = last_n_date_keys(days)
        commands = [["HGETALL", f"clicks:source:{date_key}"] for date_key in date_keys]

        try:
            responses = upstash.pipeline(commands)
        except Exception as exc:  # noqa: BLE001
            _respond_json(self, 500, {"error": str(exc)})
            return

        rows: list[dict[str, object]] = []
        for index, item in enumerate(responses):
            payload = item.get("result") if isinstance(item, dict) and "result" in item else item
            clicks_by_source = parse_hash_result(payload)
            date = key_to_iso_date(date_keys[index])
            for source_id, clicks in clicks_by_source.items():
                rows.append(
                    {
                        "date": date,
                        "source_id": source_id,
                        "clicks": clicks,
                    }
                )

        rows.sort(key=lambda row: (str(row["date"]), str(row["source_id"])))
        _respond_json(
            self,
            200,
            {
                "days": days,
                "generated_at": datetime.now(timezone.utc).isoformat(),
                "rows": rows,
            },
        )
