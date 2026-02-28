from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone
from typing import Any

from api._tracker_common import build_upstash_client


def _unwrap_pipeline_result(item: Any) -> Any:
    if isinstance(item, dict) and "result" in item:
        return item.get("result")
    return item


def _parse_hash_payload(raw: Any) -> dict[str, str]:
    payload = _unwrap_pipeline_result(raw)
    if isinstance(payload, dict):
        result: dict[str, str] = {}
        for key, value in payload.items():
            normalized_key = str(key).strip()
            if normalized_key:
                result[normalized_key] = str(value)
        return result
    if not isinstance(payload, list):
        return {}
    result: dict[str, str] = {}
    for idx in range(0, len(payload) - 1, 2):
        key = str(payload[idx]).strip()
        if not key:
            continue
        result[key] = str(payload[idx + 1])
    return result


def _parse_list_payload(raw: Any) -> list[str]:
    payload = _unwrap_pipeline_result(raw)
    if not isinstance(payload, list):
        return []
    return [str(item).strip() for item in payload if str(item).strip()]


def _iso_to_epoch_ms(value: str) -> int:
    normalized = str(value).strip()
    if not normalized:
        return int(datetime.now(timezone.utc).timestamp() * 1000)
    try:
        parsed = datetime.fromisoformat(normalized)
    except ValueError:
        return int(datetime.now(timezone.utc).timestamp() * 1000)
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return int(parsed.timestamp() * 1000)


def _date_score(report_date: str) -> int:
    digits = "".join(ch for ch in str(report_date).strip() if ch.isdigit())
    if len(digits) == 8:
        return int(digits)
    return int(datetime.now(timezone.utc).strftime("%Y%m%d"))


def _preview(text: str, max_chars: int = 140) -> str:
    normalized = " ".join(str(text or "").split())
    if not normalized:
        return ""
    if len(normalized) <= max_chars:
        return normalized
    return normalized[: max(1, max_chars - 1)].rstrip() + "…"


def build_digest_id(report_date: str, generated_at: str, markdown: str) -> str:
    epoch_ms = _iso_to_epoch_ms(generated_at)
    digest_hash = hashlib.sha256(str(markdown or "").encode("utf-8")).hexdigest()[:8]
    return f"{report_date}_{epoch_ms}_{digest_hash}"


def save_digest_archive(
    *,
    digest_id: str,
    report_date: str,
    generated_at: str,
    markdown: str,
    highlight_count: int,
    has_highlights: bool,
    summary_preview: str,
) -> None:
    upstash = build_upstash_client()
    entry_key = f"digest:entry:{digest_id}"
    date_key = f"digest:date:{report_date}"
    upstash.hset(
        entry_key,
        {
            "digest_id": digest_id,
            "date": report_date,
            "generated_at": generated_at,
            "highlight_count": int(highlight_count),
            "has_highlights": "1" if has_highlights else "0",
            "summary_preview": _preview(summary_preview, 180),
            "markdown": markdown,
        },
    )
    upstash.zadd(date_key, _iso_to_epoch_ms(generated_at), digest_id)
    upstash.zadd("digest:dates", _date_score(report_date), report_date)


def save_analysis_archive(
    *,
    digest_id: str,
    report_date: str,
    generated_at: str,
    analysis_markdown: str,
    analysis_json: dict[str, Any],
) -> None:
    upstash = build_upstash_client()
    analysis_key = f"digest:analysis:{digest_id}"
    preview_source = (
        (analysis_json.get("improvement_actions") or {}).get("ai_summary")
        if isinstance(analysis_json, dict)
        else ""
    )
    upstash.hset(
        analysis_key,
        {
            "digest_id": digest_id,
            "date": report_date,
            "generated_at": generated_at,
            "analysis_preview": _preview(str(preview_source or analysis_markdown), 180),
            "analysis_markdown": analysis_markdown,
            "analysis_json": json.dumps(analysis_json, ensure_ascii=False),
        },
    )


def list_archives(days: int = 30, limit_per_day: int = 10) -> list[dict[str, Any]]:
    bounded_days = max(1, min(int(days), 180))
    bounded_limit = max(1, min(int(limit_per_day), 50))
    upstash = build_upstash_client()

    date_rows = upstash.pipeline([["ZREVRANGE", "digest:dates", 0, bounded_days - 1]])
    dates = _parse_list_payload(date_rows[0] if date_rows else [])
    if not dates:
        return []

    commands: list[list[str | int]] = []
    for date in dates:
        commands.append(["ZREVRANGE", f"digest:date:{date}", 0, bounded_limit - 1])
    id_rows = upstash.pipeline(commands)

    groups: list[dict[str, Any]] = []
    all_digest_ids: list[str] = []
    by_date_ids: dict[str, list[str]] = {}
    for idx, date in enumerate(dates):
        digest_ids = _parse_list_payload(id_rows[idx] if idx < len(id_rows) else [])
        by_date_ids[date] = digest_ids
        all_digest_ids.extend(digest_ids)

    if not all_digest_ids:
        return []

    entry_commands: list[list[str | int]] = []
    analysis_commands: list[list[str | int]] = []
    for digest_id in all_digest_ids:
        entry_commands.append(["HGETALL", f"digest:entry:{digest_id}"])
        analysis_commands.append(["HGETALL", f"digest:analysis:{digest_id}"])
    entry_rows = upstash.pipeline(entry_commands)
    analysis_rows = upstash.pipeline(analysis_commands)

    entries: dict[str, dict[str, str]] = {}
    analysis_entries: dict[str, dict[str, str]] = {}
    for idx, digest_id in enumerate(all_digest_ids):
        row = _parse_hash_payload(entry_rows[idx] if idx < len(entry_rows) else [])
        if row:
            entries[digest_id] = row
        analysis_row = _parse_hash_payload(analysis_rows[idx] if idx < len(analysis_rows) else [])
        if analysis_row:
            analysis_entries[digest_id] = analysis_row

    for date in dates:
        items: list[dict[str, Any]] = []
        for digest_id in by_date_ids.get(date, []):
            row = entries.get(digest_id)
            if not row:
                continue
            highlight_count = int(float(row.get("highlight_count", "0") or 0))
            has_highlights = str(row.get("has_highlights", "0")).strip() in {"1", "true", "yes", "on"}
            items.append(
                {
                    "digest_id": digest_id,
                    "date": str(row.get("date") or date),
                    "generated_at": str(row.get("generated_at") or ""),
                    "highlight_count": highlight_count,
                    "has_highlights": has_highlights,
                    "summary_preview": str(row.get("summary_preview") or ""),
                    "analysis_preview": str((analysis_entries.get(digest_id) or {}).get("analysis_preview") or ""),
                    "view_url": f"/api/archive_item?id={digest_id}",
                    "analysis_url": f"/api/archive_analysis?id={digest_id}",
                }
            )
        if items:
            groups.append({"date": date, "items": items})
    return groups


def get_archive_item(digest_id: str) -> dict[str, Any] | None:
    normalized_id = str(digest_id or "").strip()
    if not normalized_id:
        return None
    upstash = build_upstash_client()
    row = upstash.hgetall(f"digest:entry:{normalized_id}")
    if not row:
        return None
    highlight_count = int(float(row.get("highlight_count", "0") or 0))
    has_highlights = str(row.get("has_highlights", "0")).strip() in {"1", "true", "yes", "on"}
    return {
        "digest_id": normalized_id,
        "date": str(row.get("date") or ""),
        "generated_at": str(row.get("generated_at") or ""),
        "highlight_count": highlight_count,
        "has_highlights": has_highlights,
        "summary_preview": str(row.get("summary_preview") or ""),
        "markdown": str(row.get("markdown") or ""),
    }


def get_archive_analysis(digest_id: str) -> dict[str, Any] | None:
    normalized_id = str(digest_id or "").strip()
    if not normalized_id:
        return None
    upstash = build_upstash_client()
    row = upstash.hgetall(f"digest:analysis:{normalized_id}")
    if not row:
        return None
    raw_json = str(row.get("analysis_json") or "{}")
    try:
        parsed_json = json.loads(raw_json)
        if not isinstance(parsed_json, dict):
            parsed_json = {}
    except json.JSONDecodeError:
        parsed_json = {}
    return {
        "digest_id": normalized_id,
        "date": str(row.get("date") or ""),
        "generated_at": str(row.get("generated_at") or ""),
        "analysis_preview": str(row.get("analysis_preview") or ""),
        "analysis_markdown": str(row.get("analysis_markdown") or ""),
        "analysis_json": parsed_json,
    }
