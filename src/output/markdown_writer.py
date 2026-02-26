from __future__ import annotations

from pathlib import Path

from src.models import DailyDigest, WORTH_MUST_READ


def render_digest_markdown(digest: DailyDigest) -> str:
    lines: list[str] = []
    lines.append("## 今日速览")
    lines.append(digest.top_summary.strip() or "- 今日暂无高质量 AI 更新。")
    lines.append("")
    lines.append("## 重点文章（最多 16）")

    if not digest.highlights:
        lines.append("- 今日暂无满足阈值的重点文章。")
    for idx, tagged_article in enumerate(digest.highlights, start=1):
        article = tagged_article.article
        marker = "⭐ " if article.worth == WORTH_MUST_READ else ""
        lines.append(f"### {idx}. {marker}[{article.title}]({article.url})")
        lines.append(f"- {article.lead_paragraph}")

    if digest.extras:
        lines.append("## 其他可关注")
        for tagged_article in digest.extras:
            article = tagged_article.article
            lines.append(f"- [{article.title}]({article.url})（{article.worth}）")
        lines.append("")

    if digest.daily_tags:
        lines.append(" ".join(digest.daily_tags))
        lines.append("")

    return "\n".join(lines).rstrip() + "\n"


def write_digest_markdown(content: str, report_date: str, output_dir: str = "reports") -> Path:
    path = Path(output_dir)
    path.mkdir(parents=True, exist_ok=True)
    output_file = path / f"{report_date}.md"
    output_file.write_text(content, encoding="utf-8")
    return output_file
