from __future__ import annotations

import os
from typing import Callable
from urllib.parse import urlparse

from src.models import DailyDigest, FlomoPayload, ScoredArticle, WORTH_MUST_READ


def _normalize_homepage_url(raw: str) -> str:
    value = str(raw or "").strip()
    if not value:
        return ""
    candidate = value if value.startswith(("http://", "https://")) else f"https://{value}"
    parsed = urlparse(candidate)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        return ""
    base_path = parsed.path or "/"
    return f"{parsed.scheme}://{parsed.netloc}{base_path}"


def resolve_flomo_homepage_url() -> str:
    candidates = [
        os.getenv("FLOMO_H5_URL", ""),
        os.getenv("DIGEST_H5_URL", ""),
        os.getenv("TRACKER_BASE_URL", ""),
        os.getenv("AI_NEWS_BASE_URL", ""),
        os.getenv("NEXT_PUBLIC_APP_URL", ""),
        os.getenv("VERCEL_URL", ""),
    ]
    for raw in candidates:
        normalized = _normalize_homepage_url(raw)
        if normalized:
            return normalized
    return ""


def render_flomo_content(
    digest: DailyDigest,
    global_tag_limit: int = 20,
    link_resolver: Callable[[ScoredArticle], str] | None = None,
    home_page_url: str = "",
) -> str:
    resolver = link_resolver or (lambda article: article.url)
    lines: list[str] = []
    lines.append("【今日速览】")
    if digest.top_summary.strip():
        lines.extend([line for line in digest.top_summary.splitlines() if line.strip()])
    else:
        lines.append("- 今日暂无高质量 AI 更新。")
    lines.append("")
    lines.append("【重点文章】")

    if not digest.highlights:
        lines.append("- 今日暂无满足阈值的重点文章。")

    for idx, tagged_article in enumerate(digest.highlights, start=1):
        article = tagged_article.article
        marker = "⭐ " if article.worth == WORTH_MUST_READ else ""
        lines.append(f"{idx}. {marker}{article.title}")
        lines.append(article.lead_paragraph)
        lines.append(f"链接：{resolver(article)}")

    normalized_home = _normalize_homepage_url(home_page_url)
    if normalized_home:
        lines.append(f"H5 页面：{normalized_home}")

    if digest.daily_tags:
        lines.append(" ".join(digest.daily_tags[:global_tag_limit]))

    return "\n".join(lines).strip() + "\n"


def build_flomo_payload(
    digest: DailyDigest,
    link_resolver: Callable[[ScoredArticle], str] | None = None,
) -> FlomoPayload:
    home_page_url = resolve_flomo_homepage_url()
    return FlomoPayload(
        content=render_flomo_content(digest, link_resolver=link_resolver, home_page_url=home_page_url),
        dedupe_key=f"digest-{digest.date}",
    )
