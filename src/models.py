from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Any


WORTH_MUST_READ = "必读"
WORTH_WORTH_READING = "可读"
WORTH_SKIP = "跳过"


@dataclass(slots=True)
class SourceConfig:
    id: str
    name: str
    url: str
    source_weight: float = 1.0


@dataclass(slots=True)
class Article:
    id: str
    title: str
    url: str
    source_id: str
    source_name: str
    published_at: datetime | None
    summary_raw: str
    lead_paragraph: str
    content_text: str
    tags: list[str] = field(default_factory=list)


@dataclass(slots=True)
class ScoredArticle(Article):
    score: float = 0.0
    worth: str = WORTH_SKIP
    reason_short: str = ""


@dataclass(slots=True)
class ArticleInsight:
    article_id: str
    one_line_summary: str
    reason_short: str


@dataclass(slots=True)
class AIHighlight:
    article_id: str
    rank: int
    one_line_summary: str
    worth: str
    reason_short: str


@dataclass(slots=True)
class TaggedArticle:
    article: ScoredArticle
    generated_tags: list[str]


@dataclass(slots=True)
class DailyDigest:
    date: str
    timezone: str
    top_summary: str
    highlights: list[TaggedArticle]
    daily_tags: list[str] = field(default_factory=list)
    extras: list[TaggedArticle] = field(default_factory=list)


@dataclass(slots=True)
class FlomoPayload:
    content: str
    dedupe_key: str


def dataclass_to_dict(obj: Any) -> dict[str, Any]:
    if hasattr(obj, "__dataclass_fields__"):
        result: dict[str, Any] = {}
        for key in obj.__dataclass_fields__.keys():
            value = getattr(obj, key)
            if hasattr(value, "__dataclass_fields__"):
                result[key] = dataclass_to_dict(value)
            elif isinstance(value, list):
                result[key] = [dataclass_to_dict(item) if hasattr(item, "__dataclass_fields__") else item for item in value]
            else:
                result[key] = value
        return result
    raise TypeError(f"Unsupported type for serialization: {type(obj)!r}")
