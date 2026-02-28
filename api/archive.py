from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler

from api._tracker_common import query_value
from src.archive.store import list_archives


def _respond_json(request: BaseHTTPRequestHandler, status: int, payload: dict[str, object]) -> None:
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    request.send_response(status)
    request.send_header("Content-Type", "application/json; charset=utf-8")
    request.send_header("Content-Length", str(len(body)))
    request.send_header("Cache-Control", "no-store, max-age=0")
    request.end_headers()
    request.wfile.write(body)


class handler(BaseHTTPRequestHandler):
    def do_GET(self) -> None:  # noqa: N802
        raw_days = query_value(self.path, "days") or str(os.getenv("ARCHIVE_DEFAULT_DAYS", "30"))
        raw_limit = query_value(self.path, "limit_per_day") or str(os.getenv("ARCHIVE_DEFAULT_LIMIT_PER_DAY", "10"))
        try:
            days = max(1, min(int(raw_days), 180))
        except ValueError:
            days = 30
        try:
            limit_per_day = max(1, min(int(raw_limit), 50))
        except ValueError:
            limit_per_day = 10

        try:
            groups = list_archives(days=days, limit_per_day=limit_per_day)
        except Exception as exc:  # noqa: BLE001
            _respond_json(self, 500, {"ok": False, "error": str(exc)})
            return

        _respond_json(
            self,
            200,
            {
                "ok": True,
                "days": days,
                "limit_per_day": limit_per_day,
                "generated_at": datetime.now(timezone.utc).isoformat(),
                "groups": groups,
            },
        )
