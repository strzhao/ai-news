from __future__ import annotations

import hashlib
import logging
import re
from datetime import datetime
from html import unescape
from typing import Iterable

import feedparser
import requests
from dateutil import parser as date_parser

from src.models import Article, SourceConfig

LOGGER = logging.getLogger(__name__)
TAG_RE = re.compile(r"<[^>]+>")
MULTISPACE_RE = re.compile(r"\s+")


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


def fetch_articles(
    sources: Iterable[SourceConfig],
    timeout_seconds: int = 20,
    max_per_source: int = 25,
) -> list[Article]:
    articles: list[Article] = []
    for source in sources:
        try:
            response = requests.get(source.url, timeout=timeout_seconds)
            response.raise_for_status()
        except requests.RequestException as exc:
            LOGGER.warning("RSS fetch failed for %s (%s): %s", source.name, source.url, exc)
            continue

        parsed = feedparser.parse(response.text)
        entries = parsed.entries[:max_per_source]
        for entry in entries:
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
