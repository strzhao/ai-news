from __future__ import annotations

from typing import Callable

from src.models import DailyDigest, FlomoPayload, ScoredArticle, WORTH_MUST_READ


def render_flomo_content(
    digest: DailyDigest,
    global_tag_limit: int = 20,
    link_resolver: Callable[[ScoredArticle], str] | None = None,
) -> str:
    resolver = link_resolver or (lambda article: article.url)
    lines: list[str] = []
    lines.append("【今日速览】")
    if digest.top_summary.strip():
        lines.extend([line for line in digest.top_summary.splitlines() if line.strip()])
    else:
        lines.append("- 今日暂无高质量 AI 更新。")
    lines.append("")
    lines.append("【重点文章（最多16）】")

    for idx, tagged_article in enumerate(digest.highlights, start=1):
        article = tagged_article.article
        marker = "⭐ " if article.worth == WORTH_MUST_READ else ""
        lines.append(f"{idx}. {marker}{article.title}")
        lines.append(article.lead_paragraph)
        lines.append(f"链接：{resolver(article)}")

    if digest.daily_tags:
        lines.append(" ".join(digest.daily_tags[:global_tag_limit]))

    return "\n".join(lines).strip() + "\n"


def build_flomo_payload(
    digest: DailyDigest,
    link_resolver: Callable[[ScoredArticle], str] | None = None,
) -> FlomoPayload:
    return FlomoPayload(
        content=render_flomo_content(digest, link_resolver=link_resolver),
        dedupe_key=f"digest-{digest.date}",
    )
