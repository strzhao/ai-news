from __future__ import annotations

from pathlib import Path
from typing import Any

import yaml

from src.models import SourceConfig


DEFAULT_CONFIG_DIR = Path(__file__).parent / "config"


def load_yaml(path: str | Path) -> dict[str, Any]:
    with Path(path).open("r", encoding="utf-8") as f:
        data = yaml.safe_load(f) or {}
    if not isinstance(data, dict):
        raise ValueError(f"YAML root must be a mapping: {path}")
    return data


def load_sources(path: str | Path | None = None) -> list[SourceConfig]:
    config_path = Path(path) if path else DEFAULT_CONFIG_DIR / "sources.yaml"
    raw = load_yaml(config_path)
    source_rows = raw.get("sources", [])
    sources: list[SourceConfig] = []
    for row in source_rows:
        sources.append(
            SourceConfig(
                id=str(row["id"]),
                name=str(row["name"]),
                url=str(row["url"]),
                source_weight=float(row.get("source_weight", 1.0)),
            )
        )
    return sources


def load_scoring(path: str | Path | None = None) -> dict[str, Any]:
    config_path = Path(path) if path else DEFAULT_CONFIG_DIR / "scoring.yaml"
    return load_yaml(config_path)


def load_tagging(path: str | Path | None = None) -> dict[str, Any]:
    config_path = Path(path) if path else DEFAULT_CONFIG_DIR / "tagging.yaml"
    return load_yaml(config_path)
