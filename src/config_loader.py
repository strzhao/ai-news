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


def _normalize_source_url(url: str) -> str:
    parsed = urlparse(url.strip())
    if not parsed.scheme or not parsed.netloc:
        return url.strip().lower().rstrip("/")

    pairs = parse_qsl(parsed.query, keep_blank_values=False)
    normalized_pairs = sorted((key.lower(), value) for key, value in pairs)
    normalized_path = parsed.path.rstrip("/") or "/"
    rebuilt = parsed._replace(
        scheme=parsed.scheme.lower(),
        netloc=parsed.netloc.lower(),
        path=normalized_path.lower(),
        query=urlencode(normalized_pairs, doseq=True),
        fragment="",
    )
    return urlunparse(rebuilt)


def load_sources(path: str | Path | None = None) -> list[SourceConfig]:
    config_path = Path(path) if path else DEFAULT_CONFIG_DIR / "sources.yaml"
    raw = load_yaml(config_path)
    source_rows = raw.get("sources", [])
    sources: list[SourceConfig] = []
    seen_ids: set[str] = set()
    seen_urls: set[str] = set()
    for row in source_rows:
        source_id = str(row["id"]).strip()
        if source_id in seen_ids:
            LOGGER.warning("Skip source %s: duplicate id", source_id)
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

        normalized_url = _normalize_source_url(url)
        if normalized_url in seen_urls:
            LOGGER.warning("Skip source %s: duplicate url %s", source_id, normalized_url)
            continue

        source_type = str(row.get("source_type", "")).strip() or None
        sources.append(
            SourceConfig(
                id=source_id,
                name=str(row["name"]),
                url=url,
                source_weight=float(row.get("source_weight", 1.0)),
                source_type=source_type,
                only_external_links=bool(row.get("only_external_links", False)),
            )
        )
        seen_ids.add(source_id)
        seen_urls.add(normalized_url)
    return sources


def load_scoring(path: str | Path | None = None) -> dict[str, Any]:
    config_path = Path(path) if path else DEFAULT_CONFIG_DIR / "scoring.yaml"
    return load_yaml(config_path)


def load_tagging(path: str | Path | None = None) -> dict[str, Any]:
    config_path = Path(path) if path else DEFAULT_CONFIG_DIR / "tagging.yaml"
    return load_yaml(config_path)
