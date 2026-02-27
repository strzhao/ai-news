from __future__ import annotations

import hashlib
import logging
import re
from datetime import datetime
from html import unescape
from typing import Iterable
from urllib.parse import urlparse

import feedparser
import requests
from dateutil import parser as date_parser

from src.models import Article, SourceConfig

LOGGER = logging.getLogger(__name__)
TAG_RE = re.compile(r"<[^>]+>")
MULTISPACE_RE = re.compile(r"\s+")
HREF_RE = re.compile(r"""href=["']([^"']+)["']""", re.IGNORECASE)
URL_RE = re.compile(r"""https?://[^\s<>"']+""", re.IGNORECASE)
X_INTERNAL_HOSTS = {
    "twitter.com",
    "www.twitter.com",
    "x.com",
    "www.x.com",
    "mobile.twitter.com",
    "mobile.x.com",
}


def _clean_html_text(value: str) -> str:
    text = TAG_RE.sub(" ", value)
    text = unescape(text)
    text = MULTISPACE_RE.sub(" ", text).strip()
    return text


def _extract_lead_paragraph(entry: feedparser.FeedParserDict) -> str:
    content_blocks = entry.get("content", [])
    if content_blocks:
        candidate = _clean_html_text(content_blocks[0].get("value", ""))
        if candidate:
            return candidate.split(".")[0][:280].strip()

    summary = _clean_html_text(entry.get("summary", ""))
    if summary:
        for split_token in ("。", ".", "!", "?", "\n"):
            if split_token in summary:
                return summary.split(split_token)[0][:280].strip()
        return summary[:280].strip()

    title = _clean_html_text(entry.get("title", ""))
    return title[:280].strip()


def _parse_published_at(entry: feedparser.FeedParserDict) -> datetime | None:
    for key in ("published", "updated", "pubDate"):
        value = entry.get(key)
        if not value:
            continue
        try:
            return date_parser.parse(value)
        except (ValueError, TypeError, OverflowError):
            continue
    return None


def _make_article_id(source_id: str, url: str, title: str) -> str:
    base = f"{source_id}|{url}|{title}".encode("utf-8", errors="ignore")
    digest = hashlib.sha256(base).hexdigest()[:12]
    return f"{source_id}-{digest}"


def _collect_entry_candidate_links(entry: feedparser.FeedParserDict) -> list[str]:
    blocks: list[str] = []
    for key in ("summary", "description"):
        value = entry.get(key, "")
        if isinstance(value, str) and value.strip():
            blocks.append(value)

    content_blocks = entry.get("content", [])
    if isinstance(content_blocks, list):
        for block in content_blocks:
            if not isinstance(block, dict):
                continue
            value = block.get("value", "")
            if isinstance(value, str) and value.strip():
                blocks.append(value)

    links: list[str] = []
    for block in blocks:
        raw = unescape(block)
        links.extend(HREF_RE.findall(raw))
        links.extend(URL_RE.findall(raw))

    return links


def _is_external_link(value: str) -> bool:
    parsed = urlparse(value.strip())
    host = parsed.netloc.lower().split(":")[0]
    if not host:
        return False
    if host == "t.co":
        # t.co almost always redirects out of X and should be treated as external.
        return True
    if host in X_INTERNAL_HOSTS:
        return False
    if host.endswith(".twitter.com") or host.endswith(".x.com") or host.endswith(".twimg.com"):
        return False
    return True


def _entry_has_external_link(entry: feedparser.FeedParserDict) -> bool:
    return any(_is_external_link(link) for link in _collect_entry_candidate_links(entry))


def fetch_articles(
    sources: Iterable[SourceConfig],
    timeout_seconds: int = 20,
    max_per_source: int = 25,
    per_source_limits: dict[str, int] | None = None,
    total_budget: int = 0,
) -> list[Article]:
    articles: list[Article] = []
    per_source_limits = per_source_limits or {}
    for source in sources:
        if total_budget > 0 and len(articles) >= total_budget:
            break
        try:
            response = requests.get(source.url, timeout=timeout_seconds)
            response.raise_for_status()
        except requests.RequestException as exc:
            LOGGER.warning("RSS fetch failed for %s (%s): %s", source.name, source.url, exc)
            continue

        parsed = feedparser.parse(response.text)
        per_source_cap = int(per_source_limits.get(source.id, max_per_source))
        entries = parsed.entries[: max(0, per_source_cap)]
        for entry in entries:
            if total_budget > 0 and len(articles) >= total_budget:
                break
            if source.only_external_links and not _entry_has_external_link(entry):
                continue
            title = _clean_html_text(entry.get("title", ""))
            url = entry.get("link", "").strip()
            if not title or not url:
                continue
            summary = _clean_html_text(entry.get("summary", ""))
            lead = _extract_lead_paragraph(entry)
            content_text = " ".join(part for part in [title, summary, lead] if part)
            article = Article(
                id=_make_article_id(source.id, url, title),
                title=title,
                url=url,
                source_id=source.id,
                source_name=source.name,
                published_at=_parse_published_at(entry),
                summary_raw=summary,
                lead_paragraph=lead,
                content_text=content_text,
            )
            articles.append(article)
    return articles
