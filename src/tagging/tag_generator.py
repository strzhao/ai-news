from __future__ import annotations

import re
from typing import Any

from src.models import ScoredArticle, TaggedArticle

NON_WORD_RE = re.compile(r"[^\w\-\u4e00-\u9fff]+")


class TagGenerator:
    def __init__(self, config: dict[str, Any], min_tags: int = 5, max_tags: int = 8) -> None:
        self.config = config
        self.min_tags = min_tags
        self.max_tags = max_tags
        self.blocked_tags = set(config.get("blocked_tags", []))
        self.synonyms = {k.lower(): v for k, v in config.get("synonyms", {}).items()}

    def generate_for_articles(
        self,
        articles: list[ScoredArticle],
        insights_by_article_id: dict[str, str] | None = None,
    ) -> list[TaggedArticle]:
        insights_by_article_id = insights_by_article_id or {}
        tagged: list[TaggedArticle] = []
        for article in articles:
            insight = insights_by_article_id.get(article.id, "")
            tags = self.generate_for_article(article, insight)
            tagged.append(TaggedArticle(article=article, generated_tags=tags))
        return tagged

    def generate_for_article(self, article: ScoredArticle, insight_text: str = "") -> list[str]:
        text = " ".join(
            [
                article.title,
                article.summary_raw,
                article.lead_paragraph,
                article.content_text,
                article.reason_short,
                insight_text,
            ]
        ).lower()

        domain_hits = self._match_tags(text, self.config.get("domain_tags", {}))
        task_hits = self._match_tags(text, self.config.get("task_tags", {}))
        tech_hits = self._match_tags(text, self.config.get("tech_tags", {}))

        # Enforce three-layer taxonomy for stronger flomo clustering.
        if not domain_hits:
            domain_hits = ["AI工程"]
        if not task_hits:
            task_hits = ["工程实践"]

        tags: list[str] = []
        tags.extend(domain_hits[:1])
        tags.extend(task_hits[:2])
        tags.extend(tech_hits[:3])

        reason_tags = self._reason_tags(article.reason_short)
        tags.extend(reason_tags)

        tags.append(article.worth)
        source_tag = NON_WORD_RE.sub("", article.source_name.replace(" ", ""))
        if source_tag:
            tags.append(source_tag)

        tags = [self._normalize_tag(tag) for tag in tags if tag]
        tags = self._unique_preserve_order(tags)
        tags = [tag for tag in tags if tag and tag not in self.blocked_tags]

        if len(tags) < self.min_tags:
            for fallback in ["AI资讯", "工程实践", "产业动态", "趋势跟踪"]:
                normalized = self._normalize_tag(fallback)
                if normalized not in tags and normalized not in self.blocked_tags:
                    tags.append(normalized)
                if len(tags) >= self.min_tags:
                    break

        return [f"#{tag}" for tag in tags[: self.max_tags]]

    def _match_tags(self, text: str, tag_map: dict[str, list[str]]) -> list[str]:
        hits: list[str] = []
        for tag_name, keywords in tag_map.items():
            if tag_name.lower() in text:
                hits.append(tag_name)
                continue
            for keyword in keywords:
                keyword_l = keyword.lower()
                if keyword_l in text:
                    hits.append(tag_name)
                    break
        return hits

    def _reason_tags(self, reason: str) -> list[str]:
        tags: list[str] = []
        reason = reason.lower()
        if "工程" in reason:
            tags.append("工程实践")
        if "新颖" in reason:
            tags.append("趋势跟踪")
        if "权威" in reason:
            tags.append("权威信源")
        if "操作" in reason or "复现" in reason:
            tags.append("可复现")
        if "时效" in reason:
            tags.append("今日更新")
        return tags

    def _normalize_tag(self, tag: str) -> str:
        candidate = tag.strip().lstrip("#")
        if not candidate:
            return ""
        mapped = self.synonyms.get(candidate.lower())
        if mapped:
            candidate = mapped
        return candidate

    @staticmethod
    def _unique_preserve_order(values: list[str]) -> list[str]:
        seen: set[str] = set()
        result: list[str] = []
        for value in values:
            if value in seen:
                continue
            seen.add(value)
            result.append(value)
        return result
