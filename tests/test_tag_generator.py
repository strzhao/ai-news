from datetime import datetime, timezone

from src.models import ScoredArticle
from src.tagging.tag_generator import TagGenerator


def _article(content_text: str, reason_short: str = "必读：工程价值+信息新颖+时效性") -> ScoredArticle:
    return ScoredArticle(
        id="a1",
        title="RAG inference optimization with vLLM",
        url="https://example.com/a1",
        source_id="openai_blog",
        source_name="OpenAI Blog",
        published_at=datetime(2026, 2, 25, tzinfo=timezone.utc),
        summary_raw="A production RAG launch with best practices.",
        lead_paragraph="Improves RAG latency with vLLM and KV cache.",
        content_text=content_text,
        score=85,
        worth="必读",
        reason_short=reason_short,
    )


def test_generate_tags_count_and_prefix() -> None:
    config = {
        "domain_tags": {"AI工程": ["production"], "大模型": ["llm"]},
        "task_tags": {"RAG": ["rag"], "推理优化": ["latency"]},
        "tech_tags": {"vLLM": ["vllm"], "KV Cache": ["kv cache"]},
        "synonyms": {},
        "blocked_tags": ["AI"],
    }
    generator = TagGenerator(config)

    tags = generator.generate_for_article(_article("production rag latency vllm kv cache"))

    assert 5 <= len(tags) <= 8
    assert all(tag.startswith("#") for tag in tags)
    assert "#AI工程" in tags
    assert "#RAG" in tags


def test_generate_tags_applies_synonyms() -> None:
    config = {
        "domain_tags": {"AI工程": ["llmops"]},
        "task_tags": {"检索增强生成": ["retrieval-augmented generation"]},
        "tech_tags": {},
        "synonyms": {"检索增强生成": "RAG"},
        "blocked_tags": [],
    }
    generator = TagGenerator(config)

    tags = generator.generate_for_article(_article("retrieval-augmented generation llmops"))

    assert "#RAG" in tags
