from __future__ import annotations

import hashlib
import re
from urllib.parse import parse_qsl, urlencode, urlparse, urlunparse

from src.models import Article


TRACKING_PARAM_PREFIXES = ("utm_", "spm", "fbclid", "gclid", "ref")
NON_ALNUM_RE = re.compile(r"[^a-z0-9]+")


def _normalize_url(url: str) -> str:
    parsed = urlparse(url.strip())
    if not parsed.scheme or not parsed.netloc:
        return ""
    query_pairs = parse_qsl(parsed.query, keep_blank_values=False)
    filtered_pairs = [
        (key, value)
        for key, value in query_pairs
        if not key.lower().startswith(TRACKING_PARAM_PREFIXES)
    ]
    rebuilt = parsed._replace(
        scheme=parsed.scheme.lower(),
        netloc=parsed.netloc.lower(),
        path=parsed.path.rstrip("/") or "/",
        query=urlencode(filtered_pairs, doseq=True),
        fragment="",
    )
    return urlunparse(rebuilt)


def build_title_key(title: str) -> str:
    normalized = NON_ALNUM_RE.sub(" ", title.lower()).strip()
    if not normalized:
        return "title:empty"
    digest = hashlib.sha256(normalized.encode("utf-8")).hexdigest()[:16]
    return f"title:{digest}"


def build_info_key(article: Article) -> str:
    for candidate in (article.info_url, article.url):
        normalized = _normalize_url(candidate)
        if normalized:
            return normalized
    return build_title_key(article.title)
