from __future__ import annotations

import json
import os
import time
import traceback
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler
from pathlib import Path
from urllib.parse import parse_qs, urlparse
from zoneinfo import ZoneInfo

from src.archive.store import build_digest_id, save_analysis_archive, save_digest_archive
from src.main import run_with_result as run_digest


def _first_query_value(path: str, key: str) -> str:
    values = parse_qs(urlparse(path).query).get(key, [])
    return str(values[0] if values else "").strip()


def _is_truthy(raw: str) -> bool:
    return str(raw or "").strip().lower() in {"1", "true", "yes", "on"}


def _is_enabled(env_name: str, default: str = "true") -> bool:
    return str(os.getenv(env_name, default) or "").strip().lower() not in {"0", "false", "no", "off"}


def _build_digest_argv(path: str, tz_name: str, output_dir: str) -> list[str]:
    target_date = _first_query_value(path, "date")
    ignore_repeat_limit = _is_truthy(_first_query_value(path, "ignore_repeat_limit"))
    top_n = _first_query_value(path, "top_n")

    argv = ["vercel-cron", "--tz", tz_name, "--output-dir", output_dir]
    if target_date:
        argv.extend(["--date", target_date])
    if top_n:
        argv.extend(["--top-n", top_n])
    if ignore_repeat_limit:
        argv.append("--ignore-repeat-limit")
    return argv


def _report_date(path: str, tz_name: str) -> str:
    target_date = _first_query_value(path, "date")
    if target_date:
        return target_date
    try:
        return datetime.now(ZoneInfo(tz_name)).strftime("%Y-%m-%d")
    except Exception:
        return datetime.now(timezone.utc).strftime("%Y-%m-%d")


def _count_highlights(markdown: str) -> int:
    return sum(1 for line in markdown.splitlines() if line.startswith("### "))


def _first_non_empty_line(text: str) -> str:
    for line in str(text or "").splitlines():
        stripped = line.strip()
        if stripped:
            return stripped
    return ""


def _runtime_env_overrides(path: str) -> dict[str, str]:
    overrides: dict[str, str] = {}
    max_eval_articles = _first_query_value(path, "max_eval_articles")
    if max_eval_articles:
        try:
            bounded = max(1, min(int(max_eval_articles), 200))
            overrides["MAX_EVAL_ARTICLES"] = str(bounded)
        except ValueError:
            pass

    analysis_ai = _first_query_value(path, "analysis_ai_summary")
    if analysis_ai:
        overrides["ANALYSIS_AI_SUMMARY_ENABLED"] = "true" if _is_truthy(analysis_ai) else "false"

    return overrides


def _analysis_archive_enabled(path: str) -> bool:
    explicit = _first_query_value(path, "archive_analysis")
    if explicit:
        return _is_truthy(explicit)
    return _is_enabled("ARCHIVE_ANALYSIS_ENABLED", "false")


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

    def _run_digest(
        self,
    ) -> tuple[int, list[str], float, str, str, int | None, str, bool, bool, bool, str]:
        tz_name = (os.getenv("DIGEST_TIMEZONE") or "Asia/Shanghai").strip() or "Asia/Shanghai"
        output_dir = (os.getenv("DIGEST_OUTPUT_DIR") or "/tmp/reports").strip() or "/tmp/reports"
        report_date = _report_date(self.path, tz_name)

        # Vercel runtime filesystem is writable only under /tmp.
        os.environ.setdefault("AI_EVAL_CACHE_DB", "/tmp/ai-news/article_eval.sqlite3")

        argv = _build_digest_argv(self.path, tz_name, output_dir)
        env_overrides = _runtime_env_overrides(self.path)

        started = time.time()
        original_env: dict[str, str | None] = {}
        try:
            for key, value in env_overrides.items():
                original_env[key] = os.environ.get(key)
                os.environ[key] = value
            run_result = run_digest(argv[1:])
        finally:
            for key, previous in original_env.items():
                if previous is None:
                    os.environ.pop(key, None)
                else:
                    os.environ[key] = previous
        exit_code = int(run_result.exit_code)
        elapsed_ms = (time.time() - started) * 1000.0
        report_path = Path(run_result.report_path) if run_result.report_path else (Path(output_dir) / f"{report_date}.md")
        highlight_count: int | None = None
        digest_id = ""
        archive_saved = False
        analysis_archive_enabled = _analysis_archive_enabled(self.path)
        analysis_archive_saved = False
        archive_error = ""
        if run_result.report_markdown:
            try:
                highlight_count = _count_highlights(run_result.report_markdown)
            except Exception:
                highlight_count = None
        if highlight_count is None:
            try:
                if report_path.exists():
                    content = report_path.read_text(encoding="utf-8")
                    highlight_count = _count_highlights(content)
            except Exception:
                highlight_count = None

        if exit_code == 0 and _is_enabled("ARCHIVE_ENABLED", "true") and run_result.report_markdown:
            generated_at = datetime.now(timezone.utc).isoformat()
            digest_id = build_digest_id(report_date, generated_at, run_result.report_markdown)
            try:
                save_digest_archive(
                    digest_id=digest_id,
                    report_date=report_date,
                    generated_at=generated_at,
                    markdown=run_result.report_markdown,
                    highlight_count=int(highlight_count or 0),
                    has_highlights=bool(highlight_count and highlight_count > 0),
                    summary_preview=_first_non_empty_line(run_result.top_summary),
                )
                if analysis_archive_enabled and run_result.analysis_markdown and run_result.analysis_json:
                    save_analysis_archive(
                        digest_id=digest_id,
                        report_date=report_date,
                        generated_at=generated_at,
                        analysis_markdown=run_result.analysis_markdown,
                        analysis_json=run_result.analysis_json,
                    )
                    analysis_archive_saved = True
                archive_saved = True
            except Exception as exc:  # noqa: BLE001
                archive_error = str(exc)

        return (
            exit_code,
            argv,
            elapsed_ms,
            report_date,
            str(report_path),
            highlight_count,
            digest_id,
            archive_saved,
            analysis_archive_enabled,
            analysis_archive_saved,
            archive_error,
        )

    def _handle(self) -> None:
        if not _is_authorized(self):
            self._json(401, {"ok": False, "error": "Unauthorized"})
            return

        started_at = datetime.now(timezone.utc).isoformat()
        try:
            (
                exit_code,
                argv,
                elapsed_ms,
                report_date,
                report_path,
                highlight_count,
                digest_id,
                archive_saved,
                analysis_archive_enabled,
                analysis_archive_saved,
                archive_error,
            ) = self._run_digest()
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
                "report_date": report_date,
                "report_path": report_path,
                "highlight_count": highlight_count,
                "has_highlights": bool(highlight_count and highlight_count > 0),
                "digest_id": digest_id,
                "archive_saved": archive_saved,
                "analysis_archive_enabled": analysis_archive_enabled,
                "analysis_archive_saved": analysis_archive_saved,
                "archive_error": archive_error,
            },
        )

    def do_GET(self) -> None:  # noqa: N802
        self._handle()

    def do_POST(self) -> None:  # noqa: N802
        self._handle()
