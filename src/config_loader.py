from __future__ import annotations

import logging
import os
from pathlib import Path
from typing import Any
from urllib.parse import parse_qsl, urlencode, urlparse, urlunparse

import yaml

from src.models import SourceConfig


DEFAULT_CONFIG_DIR = Path(__file__).parent / "config"
LOGGER = logging.getLogger(__name__)
TRACKING_PARAM_PREFIXES = ("utm_", "spm", "fbclid", "gclid", "ref")


def load_yaml(path: str | Path) -> dict[str, Any]:
    with Path(path).open("r", encoding="utf-8") as f:
        data = yaml.safe_load(f) or {}
    if not isinstance(data, dict):
        raise ValueError(f"YAML root must be a mapping: {path}")
    return data


def _join_base_and_route(base_url: str, route: str) -> str:
    base = base_url.strip().rstrip("/")
    path = route.strip()
    if not path.startswith("/"):
        path = f"/{path}"
    return f"{base}{path}"


def _normalize_route(route: str) -> str:
    path = route.strip()
    if not path.startswith("/"):
        path = f"/{path}"
    normalized = path.rstrip("/") or "/"
    return normalized.lower()


def _normalize_source_url(url: str) -> str:
    parsed = urlparse(url.strip())
    query_pairs = parse_qsl(parsed.query, keep_blank_values=False)
    filtered_pairs = [
        (k, v)
        for k, v in query_pairs
        if not k.lower().startswith(TRACKING_PARAM_PREFIXES)
    ]
    rebuilt = parsed._replace(
        scheme=parsed.scheme.lower(),
        netloc=parsed.netloc.lower(),
        path=parsed.path.rstrip("/") or "/",
        query=urlencode(sorted(filtered_pairs), doseq=True),
        fragment="",
    )
    return urlunparse(rebuilt)


def _build_source_dedupe_key(url: str, rsshub_route: str, source_type: str | None) -> tuple[str, str]:
    if rsshub_route:
        return ("rsshub_route", _normalize_route(rsshub_route))
    normalized_url = _normalize_source_url(url)
    if source_type == "twitter":
        parsed = urlparse(normalized_url)
        normalized_url = urlunparse(parsed._replace(path=(parsed.path or "/").lower()))
    return ("url", normalized_url)


def load_sources(path: str | Path | None = None) -> list[SourceConfig]:
    config_path = Path(path) if path else DEFAULT_CONFIG_DIR / "sources.yaml"
    raw = load_yaml(config_path)
    source_rows = raw.get("sources", [])
    sources: list[SourceConfig] = []
    seen_ids: set[str] = set()
    seen_dedupe_keys: set[tuple[str, str]] = set()
    for row in source_rows:
        source_id = str(row["id"])
        source_name = str(row["name"])

        if source_id in seen_ids:
            LOGGER.warning("Skip source %s: duplicate id=%s", source_name, source_id)
            continue

        url = ""
        rsshub_route = str(row.get("rsshub_route", "")).strip()
        if rsshub_route:
            rsshub_base_url = os.getenv("RSSHUB_BASE_URL", "").strip()
            if not rsshub_base_url:
                LOGGER.warning(
                    "Skip source %s: RSSHUB_BASE_URL is required for rsshub_route=%s",
                    row.get("id", "<unknown>"),
                    rsshub_route,
                )
                continue
            url = _join_base_and_route(rsshub_base_url, rsshub_route)
        else:
            url = str(row.get("url", "")).strip()

        if not url:
            LOGGER.warning("Skip source %s: missing url", row.get("id", "<unknown>"))
            continue

        source_type = str(row.get("source_type", "")).strip() or None
        dedupe_key = _build_source_dedupe_key(url, rsshub_route, source_type)
        if dedupe_key in seen_dedupe_keys:
            LOGGER.warning("Skip source %s: duplicate feed target=%s", source_id, dedupe_key[1])
            continue

        seen_ids.add(source_id)
        seen_dedupe_keys.add(dedupe_key)
        sources.append(
            SourceConfig(
                id=source_id,
                name=source_name,
                url=url,
                source_weight=float(row.get("source_weight", 1.0)),
                source_type=source_type,
                only_external_links=bool(row.get("only_external_links", False)),
            )
        )
    return sources


def load_scoring(path: str | Path | None = None) -> dict[str, Any]:
    config_path = Path(path) if path else DEFAULT_CONFIG_DIR / "scoring.yaml"
    return load_yaml(config_path)


def load_tagging(path: str | Path | None = None) -> dict[str, Any]:
    config_path = Path(path) if path else DEFAULT_CONFIG_DIR / "tagging.yaml"
    return load_yaml(config_path)
