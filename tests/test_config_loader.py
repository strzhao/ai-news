from __future__ import annotations

from pathlib import Path

from src.config_loader import load_article_types, load_sources


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


def test_load_sources_deduplicates_rss_and_twitter_sources(tmp_path: Path, monkeypatch) -> None:
    cfg = tmp_path / "sources.yaml"
    _write_sources(
        cfg,
        """
sources:
  - id: rss_a
    name: RSS A
    url: https://example.com/feed
  - id: rss_dup
    name: RSS Duplicate
    url: https://example.com/feed/
  - id: x_a
    name: X A
    rsshub_route: /twitter/user/Dotey
    source_type: twitter
  - id: x_dup
    name: X Duplicate
    rsshub_route: twitter/user/dotey/
    source_type: twitter
  - id: unique
    name: Unique
    url: https://another.com/feed.xml
  - id: unique
    name: Duplicate ID
    url: https://another-2.com/feed.xml
""".strip(),
    )
    monkeypatch.setenv("RSSHUB_BASE_URL", "https://rsshub.example.com/")

    sources = load_sources(cfg)

    assert [source.id for source in sources] == ["rss_a", "x_a", "unique"]


def test_load_article_types_deduplicates_and_keeps_other(tmp_path: Path) -> None:
    cfg = tmp_path / "types.yaml"
    cfg.write_text(
        """
types:
  - benchmark
  - engineering_practice
  - benchmark
""".strip(),
        encoding="utf-8",
    )

    types = load_article_types(cfg)

    assert types == ["benchmark", "engineering_practice", "other"]


def test_load_article_types_rejects_empty_types(tmp_path: Path) -> None:
    cfg = tmp_path / "types.yaml"
    cfg.write_text("types: []", encoding="utf-8")

    try:
        load_article_types(cfg)
    except ValueError as exc:
        assert "types cannot be empty" in str(exc)
    else:
        raise AssertionError("expected ValueError")
