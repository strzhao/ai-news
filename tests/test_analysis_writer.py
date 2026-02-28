from __future__ import annotations

from src.output.analysis_writer import build_analysis_json, generate_ai_improvement, render_analysis_markdown


def _context() -> dict[str, object]:
    return {
        "report_date": "2026-02-28",
        "timezone": "Asia/Shanghai",
        "generated_at": "2026-02-28T09:00:00+00:00",
        "pipeline_overview": {
            "source_count": 16,
            "fetched_count": 120,
            "normalized_count": 100,
            "deduped_after_dedupe": 80,
            "evaluation_pool_count": 60,
            "max_eval_articles": 60,
            "eval_cap_skipped_count": 20,
            "evaluated_count": 60,
            "selected_highlights_count": 8,
        },
        "quality_scores": [20, 35, 56, 60, 66, 72, 79, 88],
        "confidence_scores": [0.42, 0.58, 0.61, 0.73, 0.81, 0.93],
        "worth_counts": {"必读": 6, "可读": 18, "跳过": 36},
        "type_counts": {"engineering_practice": 5, "agent": 10, "other": 45},
        "selection_gates": {
            "thresholds": {"effective_threshold": 62, "selection_cap": 8},
            "gate_skips": {"low_confidence": 7, "repeat_limit_blocked": 2},
            "selection_mix": {"selected_total": 8},
        },
        "dedupe_and_repeat": {
            "total_input": 100,
            "kept_after_dedupe": 80,
            "url_duplicates": 8,
            "title_duplicates": 5,
            "dropped_items_total": 13,
            "dropped_items": [
                {
                    "reason": "url_duplicate",
                    "title": "t-a",
                    "source_id": "s1",
                    "url": "https://a.com/1",
                    "matched_title": "t-b",
                    "similarity": 1.0,
                }
            ],
            "eval_cap_skipped_count": 20,
            "eval_cap_skipped_items": [
                {
                    "title": "cap-a",
                    "source_id": "s2",
                    "url": "https://a.com/2",
                    "published_at": "2026-02-28T00:00:00+00:00",
                }
            ],
            "repeat_guard_enabled": True,
            "max_info_dup": 2,
            "repeat_blocked": 2,
        },
        "personalization_impact": {
            "behavior_summary": {"enabled": True, "count": 10},
            "type_summary": {"enabled": True, "count": 6},
            "reorder_impact": {"must_read_reordered": 2, "worth_reading_reordered": 4},
        },
        "source_quality_snapshot": {
            "top_sources": [{"source_id": "a", "quality_score": 81.2}],
            "bottom_sources": [{"source_id": "b", "quality_score": 32.9}],
        },
        "diagnostic_flags": ["跳过占比过高"],
    }


def test_build_analysis_json_contains_expected_sections() -> None:
    analysis = build_analysis_json(_context())
    assert analysis["report_date"] == "2026-02-28"
    assert "pipeline_overview" in analysis
    assert "quality_distribution" in analysis
    assert "selection_gates" in analysis
    assert "dedupe_and_repeat" in analysis
    assert "personalization_impact" in analysis
    assert "source_quality_snapshot" in analysis
    assert (analysis["quality_distribution"] or {}).get("skip_rate", 0) > 0
    actions = (analysis.get("improvement_actions") or {}).get("rule_based_actions", [])
    assert isinstance(actions, list) and len(actions) >= 1


def test_render_analysis_markdown_contains_key_blocks() -> None:
    analysis = build_analysis_json(_context())
    markdown = render_analysis_markdown(analysis)
    assert "## 诊断总览" in markdown
    assert "## 质量分布" in markdown
    assert "## 筛选闸门复盘" in markdown
    assert "## 去重与重复限制" in markdown
    assert "## 个性化影响" in markdown
    assert "## 源质量观察" in markdown
    assert "## 改进建议" in markdown
    assert "## 去重明细列表" in markdown
    assert "## 评估池截断列表" in markdown


def test_generate_ai_improvement_can_be_disabled() -> None:
    summary, actions = generate_ai_improvement({}, client=None, enabled=False)
    assert summary == ""
    assert actions == []
