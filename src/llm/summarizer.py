from __future__ import annotations

import json
import re
from typing import Any, Iterable

from src.llm.deepseek_client import DeepSeekClient, DeepSeekError
from src.models import AIHighlight, Article, WORTH_MUST_READ, WORTH_SKIP, WORTH_WORTH_READING

VALID_WORTH = {WORTH_MUST_READ, WORTH_WORTH_READING, WORTH_SKIP}
TAG_SPLIT_RE = re.compile(r"[,/\n，、;；|]+")


class DigestSummarizer:
    def __init__(self, client: DeepSeekClient) -> None:
        self.client = client

    def build_digest_content(
        self,
        articles: Iterable[Article],
        date: str,
        timezone_name: str,
        top_n: int = 8,
        language: str = "zh-CN",
    ) -> tuple[str, list[AIHighlight], list[str]]:
        article_list = list(articles)
        if not article_list:
            return "今日暂无高质量 AI 更新。", [], []

        llm_result = self._summarize_with_llm(
            article_list,
            date=date,
            timezone_name=timezone_name,
            language=language,
            top_n=top_n,
        )
        summary_lines = llm_result.get("top_summary", [])
        top_summary = "\n".join(f"- {line}" for line in summary_lines if str(line).strip())
        if not top_summary:
            raise DeepSeekError("DeepSeek returned empty top_summary")

        highlights = self._parse_highlights(llm_result, top_n=top_n)
        if not highlights:
            raise DeepSeekError("DeepSeek returned no highlights")

        daily_tags = self._parse_daily_tags(llm_result)
        return top_summary, highlights, daily_tags

    def _summarize_with_llm(
        self,
        articles: list[Article],
        date: str,
        timezone_name: str,
        language: str,
        top_n: int,
    ) -> dict[str, Any]:
        inputs = [
            {
                "article_id": article.id,
                "title": article.title,
                "source": article.source_name,
                "url": article.url,
                "published_at": article.published_at.isoformat() if article.published_at else "",
                "summary": article.summary_raw,
                "lead_paragraph": article.lead_paragraph,
            }
            for article in articles
        ]
        system_prompt = (
            "你是顶级 AI 资讯主编，偏产业实战。"
            "必须严格输出 JSON，不允许输出 Markdown 或解释。"
            "请基于文章内容完成：1) 今日速览 4-6 条；2) 重点文章排序（最多 top_n）；"
            "3) 每篇一句话总结（20-35字）；4) 阅读建议(必读/可读/跳过)；"
            "5) 阅读理由（12-28字，强调是否值得投入阅读时间）；"
            "6) 生成本期日报级技术标签 daily_tags（4-12个），只保留技术维度，避免业务/来源/泛化标签。"
            "排序必须优先实战价值：有代码/架构细节/部署经验/评测数据/成本与性能优化的内容优先；"
            "纯市场宣传、融资新闻、泛产品公告降级。"
            "daily_tags 中每个标签都要简短、准确、有聚类价值。"
            "输出字段：top_summary:string[]，highlights:object[]，daily_tags:string[]。"
            "highlights 中每项字段：article_id, rank, one_line_summary, worth, reason_short。"
        )
        user_prompt = {
            "date": date,
            "timezone": timezone_name,
            "language": language,
            "top_n": top_n,
            "articles": inputs,
        }

        result = self.client.chat_json(
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": json.dumps(user_prompt, ensure_ascii=False)},
            ],
            temperature=0.1,
        )
        if not isinstance(result, dict):
            raise DeepSeekError(f"Unexpected summarize result: {result}")
        return result

    def _parse_highlights(self, llm_result: dict[str, Any], top_n: int) -> list[AIHighlight]:
        raw_highlights = llm_result.get("highlights", [])
        if not isinstance(raw_highlights, list):
            raise DeepSeekError("DeepSeek highlights must be a list")

        parsed: list[AIHighlight] = []
        for row in raw_highlights:
            if not isinstance(row, dict):
                continue
            article_id = str(row.get("article_id", "")).strip()
            if not article_id:
                continue
            worth = str(row.get("worth", "")).strip()
            if worth not in VALID_WORTH:
                raise DeepSeekError(f"Invalid worth label from DeepSeek: {worth}")

            parsed.append(
                AIHighlight(
                    article_id=article_id,
                    rank=int(row.get("rank", len(parsed) + 1)),
                    one_line_summary=str(row.get("one_line_summary", "")).strip(),
                    worth=worth,
                    reason_short=str(row.get("reason_short", "")).strip(),
                )
            )

        parsed.sort(key=lambda item: item.rank)
        return parsed[:top_n]

    def _parse_daily_tags(self, llm_result: dict[str, Any]) -> list[str]:
        raw_tags = llm_result.get("daily_tags", [])
        tags = self._coerce_tags(raw_tags)
        cleaned: list[str] = []
        for tag in tags:
            value = str(tag).strip().lstrip("#")
            if value:
                cleaned.append(f"#{value}")
        deduped = list(dict.fromkeys(cleaned))
        # Keep output concise and focused.
        return deduped[:12]

    @staticmethod
    def _coerce_tags(tags: Any) -> list[str]:
        if isinstance(tags, list):
            return [str(item) for item in tags]
        if isinstance(tags, str):
            raw = tags.strip()
            if not raw:
                return []
            normalized = raw.replace("#", " ")
            if TAG_SPLIT_RE.search(normalized):
                return [part.strip() for part in TAG_SPLIT_RE.split(normalized) if part.strip()]
            return [part.strip() for part in normalized.split() if part.strip()]
        return []
