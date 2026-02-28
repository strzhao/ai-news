from __future__ import annotations

import json
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler

from api._tracker_common import query_value
from src.archive.store import get_archive_item


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
        digest_id = query_value(self.path, "id")
        if not digest_id:
            _respond_json(self, 400, {"ok": False, "error": "Missing id"})
            return

        try:
            item = get_archive_item(digest_id)
        except Exception as exc:  # noqa: BLE001
            _respond_json(self, 500, {"ok": False, "error": str(exc)})
            return

        if not item:
            _respond_json(self, 404, {"ok": False, "error": "Not found"})
            return

        _respond_json(
            self,
            200,
            {
                "ok": True,
                "generated_at": datetime.now(timezone.utc).isoformat(),
                "item": item,
            },
        )
