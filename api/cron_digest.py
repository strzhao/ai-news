from __future__ import annotations

import json
import os
import sys
import time
import traceback
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler
from urllib.parse import parse_qs, urlparse

from src.main import run as run_digest


def _first_query_value(path: str, key: str) -> str:
    values = parse_qs(urlparse(path).query).get(key, [])
    return str(values[0] if values else "").strip()


def _is_truthy(raw: str) -> bool:
    return str(raw or "").strip().lower() in {"1", "true", "yes", "on"}


def _build_digest_argv(path: str, tz_name: str, output_dir: str) -> list[str]:
    target_date = _first_query_value(path, "date")
    ignore_repeat_limit = _is_truthy(_first_query_value(path, "ignore_repeat_limit"))

    argv = ["vercel-cron", "--tz", tz_name, "--output-dir", output_dir]
    if target_date:
        argv.extend(["--date", target_date])
    if ignore_repeat_limit:
        argv.append("--ignore-repeat-limit")
    return argv


def _is_authorized(request: BaseHTTPRequestHandler) -> bool:
    cron_secret = (os.getenv("CRON_SECRET") or "").strip()
    auth_header = str(request.headers.get("authorization") or "").strip()
    query_token = _first_query_value(request.path, "token")

    if cron_secret:
        if auth_header == f"Bearer {cron_secret}":
            return True
        # Compatibility fallback: some clients may not forward Authorization header.
        return query_token == cron_secret

    # Fallback for manual invocation when CRON_SECRET is not configured.
    manual_token = (os.getenv("DIGEST_MANUAL_TOKEN") or "").strip()
    if not manual_token:
        return True
    return query_token == manual_token


class handler(BaseHTTPRequestHandler):
    def _json(self, status: int, payload: dict[str, object]) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _run_digest(self) -> tuple[int, list[str], float]:
        tz_name = (os.getenv("DIGEST_TIMEZONE") or "Asia/Shanghai").strip() or "Asia/Shanghai"
        output_dir = (os.getenv("DIGEST_OUTPUT_DIR") or "/tmp/reports").strip() or "/tmp/reports"

        # Vercel runtime filesystem is writable only under /tmp.
        os.environ.setdefault("AI_EVAL_CACHE_DB", "/tmp/ai-news/article_eval.sqlite3")

        argv = _build_digest_argv(self.path, tz_name, output_dir)

        started = time.time()
        original_argv = sys.argv[:]
        try:
            sys.argv = argv
            exit_code = int(run_digest())
        finally:
            sys.argv = original_argv
        elapsed_ms = (time.time() - started) * 1000.0
        return exit_code, argv, elapsed_ms

    def _handle(self) -> None:
        if not _is_authorized(self):
            self._json(401, {"ok": False, "error": "Unauthorized"})
            return

        started_at = datetime.now(timezone.utc).isoformat()
        try:
            exit_code, argv, elapsed_ms = self._run_digest()
        except Exception as exc:  # noqa: BLE001
            self._json(
                500,
                {
                    "ok": False,
                    "error": str(exc),
                    "started_at": started_at,
                    "traceback": traceback.format_exc(),
                },
            )
            return

        status = 200 if exit_code == 0 else 500
        self._json(
            status,
            {
                "ok": exit_code == 0,
                "exit_code": exit_code,
                "started_at": started_at,
                "elapsed_ms": round(elapsed_ms, 2),
                "argv": argv,
            },
        )

    def do_GET(self) -> None:  # noqa: N802
        self._handle()

    def do_POST(self) -> None:  # noqa: N802
        self._handle()
