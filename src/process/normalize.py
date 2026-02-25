from __future__ import annotations

import re
from datetime import timezone

from src.models import Article

MULTISPACE_RE = re.compile(r"\s+")


def _normalize_text(value: str, max_len: int = 1200) -> str:
    value = MULTISPACE_RE.sub(" ", value or "").strip()
    if len(value) <= max_len:
        return value
    return value[:max_len].rstrip() + "..."


def normalize_articles(articles: list[Article]) -> list[Article]:
    normalized: list[Article] = []
    for article in articles:
        published_at = article.published_at
        if published_at and published_at.tzinfo is None:
            published_at = published_at.replace(tzinfo=timezone.utc)
        elif published_at:
            published_at = published_at.astimezone(timezone.utc)

        normalized.append(
            Article(
                id=article.id,
                title=_normalize_text(article.title, max_len=240),
                url=article.url.strip(),
                source_id=article.source_id,
                source_name=article.source_name,
                published_at=published_at,
                summary_raw=_normalize_text(article.summary_raw, max_len=1600),
                lead_paragraph=_normalize_text(article.lead_paragraph, max_len=320),
                content_text=_normalize_text(article.content_text, max_len=2400),
                tags=article.tags[:],
            )
        )
    return normalized
