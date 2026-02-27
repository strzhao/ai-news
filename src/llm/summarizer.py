from __future__ import annotations

import json
import re
from typing import Any, Iterable

from src.llm.deepseek_client import DeepSeekClient, DeepSeekError
from src.models import (
    AIHighlight,
    Article,
    ArticleAssessment,
    SourceQualityScore,
    WORTH_MUST_READ,
    WORTH_SKIP,
    WORTH_WORTH_READING,
)

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
        assessments: dict[str, ArticleAssessment] | None = None,
        source_quality_scores: dict[str, SourceQualityScore] | None = None,
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
            assessments=assessments,
            source_quality_scores=source_quality_scores,
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
        assessments: dict[str, ArticleAssessment] | None = None,
        source_quality_scores: dict[str, SourceQualityScore] | None = None,
    ) -> dict[str, Any]:
        inputs = []
        source_quality_scores = source_quality_scores or {}
        for article in articles:
            assessment = (assessments or {}).get(article.id)
            source_quality = source_quality_scores.get(article.source_id)
            row = {
                "article_id": article.id,
                "title": article.title,
                "source": article.source_name,
                "url": article.url,
                "published_at": article.published_at.isoformat() if article.published_at else "",
                "summary": article.summary_raw,
                "lead_paragraph": article.lead_paragraph,
            }
            if assessment:
                row["assessment"] = {
                    "worth": assessment.worth,
                    "quality_score": assessment.quality_score,
                    "practicality_score": assessment.practicality_score,
                    "actionability_score": assessment.actionability_score,
                    "novelty_score": assessment.novelty_score,
                    "clarity_score": assessment.clarity_score,
                    "company_impact": assessment.company_impact,
                    "team_impact": assessment.team_impact,
                    "personal_impact": assessment.personal_impact,
                    "execution_clarity": assessment.execution_clarity,
                    "one_line_summary": assessment.one_line_summary,
                    "reason_short": assessment.reason_short,
                    "action_hint": assessment.action_hint,
                    "best_for_roles": assessment.best_for_roles,
                    "evidence_signals": assessment.evidence_signals,
                    "confidence": assessment.confidence,
                    "primary_type": assessment.primary_type,
                    "secondary_types": assessment.secondary_types,
                }
            if source_quality:
                row["source_quality_score"] = source_quality.quality_score
            inputs.append(row)

        if assessments:
            system_prompt = (
                "你是顶级 AI 资讯主编，偏产业实战。"
                "你收到的是文章基础信息+单篇AI评估结果。单篇评估已完成，你需要做二次编排。"
                "必须严格输出 JSON，不允许输出 Markdown 或解释。"
                "请完成：1) 今日速览 2-3 条；2) 重点文章排序（最多 top_n）；"
                "3) 每篇一句话总结（20-35字，可沿用单篇评估结论）；"
                "4) 阅读建议(必读/可读/跳过)；5) 阅读理由（12-28字）；"
                "6) 生成本期日报级技术标签 daily_tags（3-10个），只保留技术维度。"
                "排序规则：优先 reading ROI（quality_score）和 company/team/personal impact、execution_clarity，"
                "再参考 novelty、时效性、source_quality_score。"
                "核心目标是帮助公司、团队和个人在 AI 上持续进步，不做机械化“必须有代码”判断。"
                "今日速览必须做主题级整合：每条覆盖多篇文章的共同趋势或结论，"
                "禁止按“每篇文章一句话”逐条罗列；每条尽量 22-32 字，整体控制精炼。"
                "highlights 是严格精选清单，不是文章全集；默认返回 4-10 条，"
                "只有当高杠杆内容明显充足时才接近 top_n。"
                "highlights 只保留值得投入阅读时间的文章，若质量不够可少于 top_n；"
                "默认不应把 worth=跳过 的文章放进 highlights。"
                "输出字段：top_summary:string[]，highlights:object[]，daily_tags:string[]。"
                "highlights 字段：article_id, rank, one_line_summary, worth, reason_short。"
            )
        else:
            system_prompt = (
                "你是顶级 AI 资讯主编，偏产业实战。"
                "必须严格输出 JSON，不允许输出 Markdown 或解释。"
                "请基于文章内容完成：1) 今日速览 2-3 条；2) 重点文章排序（最多 top_n）；"
                "3) 每篇一句话总结（20-35字）；4) 阅读建议(必读/可读/跳过)；"
                "5) 阅读理由（12-28字，强调是否值得投入阅读时间）；"
                "6) 生成本期日报级技术标签 daily_tags（4-12个），只保留技术维度，避免业务/来源/泛化标签。"
                "排序必须优先实战价值：有代码/架构细节/部署经验/评测数据/成本与性能优化的内容优先；"
                "纯市场宣传、融资新闻、泛产品公告降级。"
                "今日速览必须是主题整合，禁止逐篇复述；每条尽量 22-32 字，整体简洁。"
                "highlights 是严格精选清单，不是文章全集；默认返回 4-10 条，"
                "只有当高杠杆内容明显充足时才接近 top_n。"
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
