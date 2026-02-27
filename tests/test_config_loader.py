from __future__ import annotations

from pathlib import Path

from src.config_loader import load_sources


def _write_sources(path: Path, body: str) -> None:
    path.write_text(body, encoding="utf-8")


def test_load_sources_builds_rsshub_url_when_base_present(tmp_path: Path, monkeypatch) -> None:
    cfg = tmp_path / "sources.yaml"
    _write_sources(
        cfg,
        """
sources:
  - id: x_test
    name: X Test
    rsshub_route: /twitter/user/test
    source_type: twitter
    only_external_links: true
    source_weight: 0.95
""".strip(),
    )
    monkeypatch.setenv("RSSHUB_BASE_URL", "https://rsshub.example.com/")

    sources = load_sources(cfg)

    assert len(sources) == 1
    assert sources[0].url == "https://rsshub.example.com/twitter/user/test"
    assert sources[0].source_type == "twitter"
    assert sources[0].only_external_links is True


def test_load_sources_skips_rsshub_route_when_base_missing(tmp_path: Path, monkeypatch) -> None:
    cfg = tmp_path / "sources.yaml"
    _write_sources(
        cfg,
        """
sources:
  - id: x_test
    name: X Test
    rsshub_route: /twitter/user/test
  - id: normal
    name: Normal
    url: https://example.com/feed.xml
""".strip(),
    )
    monkeypatch.delenv("RSSHUB_BASE_URL", raising=False)

    sources = load_sources(cfg)

    assert len(sources) == 1
    assert sources[0].id == "normal"
