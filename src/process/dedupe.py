from __future__ import annotations

import re
from difflib import SequenceMatcher
from urllib.parse import parse_qsl, urlencode, urlparse, urlunparse

from src.models import Article

TRACKING_PARAM_PREFIXES = ("utm_", "spm", "fbclid", "gclid", "ref")
NON_ALNUM_RE = re.compile(r"[^a-z0-9]+")


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


def dedupe_articles(articles: list[Article], title_similarity_threshold: float = 0.93) -> list[Article]:
    deduped: list[Article] = []
    seen_urls: set[str] = set()

    for article in articles:
        normalized = normalize_url(article.url)
        if normalized in seen_urls:
            continue

        duplicate = False
        for existing in deduped:
            if _title_similarity(article.title, existing.title) >= title_similarity_threshold:
                duplicate = True
                break

        if duplicate:
            continue

        seen_urls.add(normalized)
        deduped.append(article)

    return deduped
