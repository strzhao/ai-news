from __future__ import annotations

import re
from dataclasses import dataclass, field
from difflib import SequenceMatcher
from urllib.parse import parse_qsl, urlencode, urlparse, urlunparse

from src.models import Article

TRACKING_PARAM_PREFIXES = ("utm_", "spm", "fbclid", "gclid", "ref")
NON_ALNUM_RE = re.compile(r"[^a-z0-9]+")


@dataclass(slots=True)
class DedupeStats:
    total_input: int
    kept: int
    url_duplicates: int
    title_duplicates: int
    dropped_items: list[dict[str, str | float]] = field(default_factory=list)


def normalize_url(url: str) -> str:
    parsed = urlparse(url.strip())
    query_pairs = parse_qsl(parsed.query, keep_blank_values=False)
    filtered_pairs = [
        (k, v)
        for k, v in query_pairs
        if not k.lower().startswith(TRACKING_PARAM_PREFIXES)
    ]
    normalized_path = parsed.path.rstrip("/") or "/"
    rebuilt = parsed._replace(
        scheme=parsed.scheme.lower(),
        netloc=parsed.netloc.lower(),
        path=normalized_path,
        query=urlencode(filtered_pairs, doseq=True),
        fragment="",
    )
    return urlunparse(rebuilt)


def _normalized_title(title: str) -> str:
    lower = title.lower()
    return NON_ALNUM_RE.sub(" ", lower).strip()


def _title_similarity(title_a: str, title_b: str) -> float:
    return SequenceMatcher(None, _normalized_title(title_a), _normalized_title(title_b)).ratio()


def dedupe_articles(
    articles: list[Article],
    title_similarity_threshold: float = 0.93,
    return_stats: bool = False,
) -> list[Article] | tuple[list[Article], DedupeStats]:
    deduped: list[Article] = []
    seen_urls: set[str] = set()
    normalized_to_article: dict[str, Article] = {}
    url_duplicates = 0
    title_duplicates = 0
    dropped_items: list[dict[str, str | float]] = []

    for article in articles:
        normalized = normalize_url(article.url)
        if normalized in seen_urls:
            url_duplicates += 1
            matched = normalized_to_article.get(normalized)
            dropped_items.append(
                {
                    "reason": "url_duplicate",
                    "article_id": article.id,
                    "title": article.title,
                    "source_id": article.source_id,
                    "url": article.url,
                    "matched_article_id": matched.id if matched else "",
                    "matched_title": matched.title if matched else "",
                    "matched_url": matched.url if matched else "",
                    "similarity": 1.0,
                }
            )
            continue

        duplicate = False
        duplicate_match: Article | None = None
        duplicate_similarity = 0.0
        for existing in deduped:
            similarity = _title_similarity(article.title, existing.title)
            if similarity >= title_similarity_threshold:
                duplicate = True
                duplicate_match = existing
                duplicate_similarity = similarity
                break

        if duplicate:
            title_duplicates += 1
            dropped_items.append(
                {
                    "reason": "title_similar",
                    "article_id": article.id,
                    "title": article.title,
                    "source_id": article.source_id,
                    "url": article.url,
                    "matched_article_id": duplicate_match.id if duplicate_match else "",
                    "matched_title": duplicate_match.title if duplicate_match else "",
                    "matched_url": duplicate_match.url if duplicate_match else "",
                    "similarity": round(duplicate_similarity, 4),
                }
            )
            continue

        seen_urls.add(normalized)
        normalized_to_article[normalized] = article
        deduped.append(article)

    if not return_stats:
        return deduped
    return (
        deduped,
        DedupeStats(
            total_input=len(articles),
            kept=len(deduped),
            url_duplicates=url_duplicates,
            title_duplicates=title_duplicates,
            dropped_items=dropped_items,
        ),
    )
