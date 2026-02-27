from __future__ import annotations

from src.fetch.rss_fetcher import fetch_articles
from src.models import SourceConfig


class _MockResponse:
    def __init__(self, text: str) -> None:
        self.text = text

    def raise_for_status(self) -> None:
        return None


def _rss_feed() -> str:
    return """<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>test</title>
    <item>
      <title>External link</title>
      <link>https://x.com/u/status/1</link>
      <description><![CDATA[Read <a href="https://example.com/post">here</a>]]></description>
      <pubDate>Fri, 21 Feb 2025 10:00:00 GMT</pubDate>
    </item>
    <item>
      <title>Only x link</title>
      <link>https://x.com/u/status/2</link>
      <description><![CDATA[See <a href="https://x.com/u/status/2">tweet</a>]]></description>
      <pubDate>Fri, 21 Feb 2025 09:00:00 GMT</pubDate>
    </item>
    <item>
      <title>tco short link</title>
      <link>https://x.com/u/status/3</link>
      <description><![CDATA[Open <a href="https://t.co/abc123">link</a>]]></description>
      <pubDate>Fri, 21 Feb 2025 08:00:00 GMT</pubDate>
    </item>
  </channel>
</rss>"""


def test_fetch_articles_filters_external_links_for_twitter_sources(monkeypatch) -> None:
    feed = _rss_feed()
    monkeypatch.setattr(
        "src.fetch.rss_fetcher.requests.get",
        lambda _url, timeout=20: _MockResponse(feed),
    )
    source = SourceConfig(
        id="x_source",
        name="X Source",
        url="https://rsshub.example.com/twitter/user/test",
        source_type="twitter",
        only_external_links=True,
    )
    articles = fetch_articles([source])
    titles = [item.title for item in articles]
    assert titles == ["External link", "tco short link"]


def test_fetch_articles_keeps_all_when_filter_disabled(monkeypatch) -> None:
    feed = _rss_feed()
    monkeypatch.setattr(
        "src.fetch.rss_fetcher.requests.get",
        lambda _url, timeout=20: _MockResponse(feed),
    )
    source = SourceConfig(
        id="x_source",
        name="X Source",
        url="https://rsshub.example.com/twitter/user/test",
        source_type="twitter",
        only_external_links=False,
    )
    articles = fetch_articles([source])
    assert len(articles) == 3
