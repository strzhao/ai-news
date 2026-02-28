from __future__ import annotations

import json
from datetime import datetime, timezone
from math import ceil, floor
from pathlib import Path
from statistics import mean
from typing import Any

from src.llm.deepseek_client import DeepSeekClient, DeepSeekError


def _percentile(values: list[float], percentile: float) -> float:
    if not values:
        return 0.0
    sorted_values = sorted(values)
    if percentile <= 0:
        return sorted_values[0]
    if percentile >= 100:
        return sorted_values[-1]
    index = (len(sorted_values) - 1) * (percentile / 100.0)
    lower = floor(index)
    upper = ceil(index)
    if lower == upper:
        return sorted_values[lower]
    weight = index - lower
    return sorted_values[lower] * (1 - weight) + sorted_values[upper] * weight


def _round_float(value: float, digits: int = 2) -> float:
    return round(float(value), digits)


def _to_float_list(values: list[Any]) -> list[float]:
    results: list[float] = []
    for value in values:
        try:
            results.append(float(value))
        except (TypeError, ValueError):
            continue
    return results


def _build_rule_actions(analysis: dict[str, Any]) -> list[str]:
    actions: list[str] = []
    pipeline_overview = analysis.get("pipeline_overview") or {}
    quality_distribution = analysis.get("quality_distribution") or {}
    selection_gates = analysis.get("selection_gates") or {}
    dedupe_and_repeat = analysis.get("dedupe_and_repeat") or {}

    selected = int(pipeline_overview.get("selected_highlights_count", 0) or 0)
    deduped_count = int(
        pipeline_overview.get(
            "evaluation_pool_count",
            pipeline_overview.get("deduped_count", 0),
        )
        or 0
    )
    skip_rate = float(quality_distribution.get("skip_rate", 0.0) or 0.0)
    low_confidence = int((selection_gates.get("gate_skips") or {}).get("low_confidence", 0) or 0)
    repeat_blocked = int((selection_gates.get("gate_skips") or {}).get("repeat_limit_blocked", 0) or 0)
    url_dups = int(dedupe_and_repeat.get("url_duplicates", 0) or 0)
    title_dups = int(dedupe_and_repeat.get("title_duplicates", 0) or 0)

    if deduped_count > 0 and selected <= max(2, int(deduped_count * 0.08)):
        actions.append("重点文章入选偏低，建议下调 must_read 阈值或提高候选覆盖（增加高质量源抓取密度）。")
    if skip_rate >= 0.7:
        actions.append("跳过占比过高，建议收紧源池并增加 source_quality 低分源的惩罚。")
    if low_confidence >= max(5, int(deduped_count * 0.15)):
        actions.append("低置信度落选较多，建议优化单篇评估提示词并增加失败重试上限。")
    if repeat_blocked > 0:
        actions.append("重复限制已拦截候选，说明内容同质化明显，建议扩充来源多样性与主题覆盖。")
    if (url_dups + title_dups) >= max(8, int(deduped_count * 0.2)):
        actions.append("去重命中偏高，建议在抓取阶段强化聚合源去重和同源近似标题过滤。")
    if not actions:
        actions.append("当前产线信号稳定，可保持阈值并持续观察 7 天滚动指标。")
    return actions[:8]


def build_analysis_json(context: dict[str, Any]) -> dict[str, Any]:
    report_date = str(context.get("report_date") or "")
    timezone_name = str(context.get("timezone") or "")
    generated_at = str(context.get("generated_at") or datetime.now(timezone.utc).isoformat())
    pipeline_overview = dict(context.get("pipeline_overview") or {})

    quality_scores = _to_float_list(context.get("quality_scores") or [])
    confidence_scores = _to_float_list(context.get("confidence_scores") or [])
    worth_counts = dict(context.get("worth_counts") or {})
    type_counts = dict(context.get("type_counts") or {})

    evaluated_count = int(context.get("evaluated_count", pipeline_overview.get("evaluated_count", 0)) or 0)
    skip_count = int(worth_counts.get("跳过", 0) or 0)
    skip_rate = (skip_count / evaluated_count) if evaluated_count > 0 else 0.0

    quality_distribution = {
        "worth_counts": worth_counts,
        "type_counts": type_counts,
        "quality_percentiles": {
            "p10": _round_float(_percentile(quality_scores, 10)),
            "p25": _round_float(_percentile(quality_scores, 25)),
            "p50": _round_float(_percentile(quality_scores, 50)),
            "p75": _round_float(_percentile(quality_scores, 75)),
            "p90": _round_float(_percentile(quality_scores, 90)),
        },
        "confidence_percentiles": {
            "p10": _round_float(_percentile(confidence_scores, 10), 3),
            "p50": _round_float(_percentile(confidence_scores, 50), 3),
            "p90": _round_float(_percentile(confidence_scores, 90), 3),
        },
        "avg_quality": _round_float(mean(quality_scores), 2) if quality_scores else 0.0,
        "avg_confidence": _round_float(mean(confidence_scores), 3) if confidence_scores else 0.0,
        "skip_rate": _round_float(skip_rate, 4),
    }

    analysis = {
        "report_date": report_date,
        "timezone": timezone_name,
        "generated_at": generated_at,
        "pipeline_overview": pipeline_overview,
        "quality_distribution": quality_distribution,
        "selection_gates": dict(context.get("selection_gates") or {}),
        "dedupe_and_repeat": dict(context.get("dedupe_and_repeat") or {}),
        "personalization_impact": dict(context.get("personalization_impact") or {}),
        "source_quality_snapshot": dict(context.get("source_quality_snapshot") or {}),
        "diagnostic_flags": list(context.get("diagnostic_flags") or []),
        "improvement_actions": {
            "rule_based_actions": [],
            "ai_summary": "",
            "ai_actions": [],
        },
    }
    analysis["improvement_actions"]["rule_based_actions"] = _build_rule_actions(analysis)
    return analysis


def generate_ai_improvement(
    analysis_json: dict[str, Any],
    *,
    client: DeepSeekClient | None,
    enabled: bool,
) -> tuple[str, list[str]]:
    if not enabled or client is None:
        return "", []
    compact_payload = {
        "pipeline_overview": analysis_json.get("pipeline_overview", {}),
        "quality_distribution": analysis_json.get("quality_distribution", {}),
        "selection_gates": analysis_json.get("selection_gates", {}),
        "dedupe_and_repeat": analysis_json.get("dedupe_and_repeat", {}),
        "personalization_impact": analysis_json.get("personalization_impact", {}),
        "diagnostic_flags": analysis_json.get("diagnostic_flags", []),
    }
    system_prompt = (
        "你是 AI 内容策略与质量优化顾问。"
        "请基于输入的日报产线诊断数据，给出一段精炼总结和最多 6 条可执行改进建议。"
        "只输出 JSON，字段为 summary:string, actions:string[]。"
        "summary 控制在 120 字以内，actions 每条控制在 18-42 字。"
        "必须面向工程执行，不要空话。"
    )
    try:
        result = client.chat_json(
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": json.dumps(compact_payload, ensure_ascii=False)},
            ],
            temperature=0.1,
        )
    except DeepSeekError:
        return "", []

    summary = str(result.get("summary", "")).strip()
    actions_raw = result.get("actions", [])
    if not isinstance(actions_raw, list):
        actions_raw = []
    actions = [str(item).strip() for item in actions_raw if str(item).strip()]
    return summary, actions[:6]


def render_analysis_markdown(analysis: dict[str, Any]) -> str:
    pipeline_overview = analysis.get("pipeline_overview") or {}
    quality_distribution = analysis.get("quality_distribution") or {}
    selection_gates = analysis.get("selection_gates") or {}
    dedupe_and_repeat = analysis.get("dedupe_and_repeat") or {}
    personalization = analysis.get("personalization_impact") or {}
    source_quality_snapshot = analysis.get("source_quality_snapshot") or {}
    improvement_actions = analysis.get("improvement_actions") or {}

    deduped_after = int(
        pipeline_overview.get(
            "deduped_after_dedupe",
            pipeline_overview.get("deduped_count", 0),
        )
        or 0
    )
    eval_pool = int(
        pipeline_overview.get(
            "evaluation_pool_count",
            pipeline_overview.get("evaluated_count", 0),
        )
        or 0
    )
    max_eval = int(pipeline_overview.get("max_eval_articles", 0) or 0)
    eval_cap_skipped = int(pipeline_overview.get("eval_cap_skipped_count", 0) or 0)

    lines: list[str] = []
    lines.append("## 诊断总览")
    lines.append(
        f"- 报告日期：{analysis.get('report_date', '-')}"
        f"（{analysis.get('timezone', '-')})，生成时间：{analysis.get('generated_at', '-')}"
    )
    lines.append(
        "- 流水线规模："
        f"源 {pipeline_overview.get('source_count', 0)}，"
        f"抓取 {pipeline_overview.get('fetched_count', 0)}，"
        f"标准化 {pipeline_overview.get('normalized_count', 0)}，"
        f"去重后 {deduped_after}，"
        f"评估池 {eval_pool}（上限 {max_eval}，截断 {eval_cap_skipped}），"
        f"评估 {pipeline_overview.get('evaluated_count', 0)}，"
        f"入选 {pipeline_overview.get('selected_highlights_count', 0)}。"
    )
    lines.append("")

    lines.append("## 质量分布")
    lines.append(f"- worth 分布：{json.dumps(quality_distribution.get('worth_counts', {}), ensure_ascii=False)}")
    lines.append(f"- 类型分布：{json.dumps(quality_distribution.get('type_counts', {}), ensure_ascii=False)}")
    lines.append(
        "- 质量分位："
        f"{json.dumps(quality_distribution.get('quality_percentiles', {}), ensure_ascii=False)}；"
        f"平均质量 {quality_distribution.get('avg_quality', 0)}。"
    )
    lines.append(
        "- 置信度分位："
        f"{json.dumps(quality_distribution.get('confidence_percentiles', {}), ensure_ascii=False)}；"
        f"平均置信度 {quality_distribution.get('avg_confidence', 0)}，"
        f"跳过占比 {quality_distribution.get('skip_rate', 0)}。"
    )
    lines.append("")

    lines.append("## 筛选闸门复盘")
    lines.append(f"- 阈值快照：{json.dumps(selection_gates.get('thresholds', {}), ensure_ascii=False)}")
    lines.append(f"- 落选计数：{json.dumps(selection_gates.get('gate_skips', {}), ensure_ascii=False)}")
    lines.append(f"- 入选结构：{json.dumps(selection_gates.get('selection_mix', {}), ensure_ascii=False)}")
    lines.append("")

    lines.append("## 去重与重复限制")
    lines.append(
        f"- URL 去重命中：{dedupe_and_repeat.get('url_duplicates', 0)}，"
        f"标题近似去重命中：{dedupe_and_repeat.get('title_duplicates', 0)}。"
    )
    lines.append(
        f"- 重复限制：enabled={dedupe_and_repeat.get('repeat_guard_enabled', False)}，"
        f"max={dedupe_and_repeat.get('max_info_dup', 0)}，"
        f"blocked={dedupe_and_repeat.get('repeat_blocked', 0)}。"
    )
    lines.append(
        f"- 评估池截断：max_eval={pipeline_overview.get('max_eval_articles', 0)}，"
        f"超出未评估={dedupe_and_repeat.get('eval_cap_skipped_count', 0)}。"
    )
    lines.append("")

    lines.append("## 个性化影响")
    lines.append(f"- 行为个性化：{json.dumps(personalization.get('behavior_summary', {}), ensure_ascii=False)}")
    lines.append(f"- 类型个性化：{json.dumps(personalization.get('type_summary', {}), ensure_ascii=False)}")
    lines.append(f"- 重排影响：{json.dumps(personalization.get('reorder_impact', {}), ensure_ascii=False)}")
    lines.append("")

    lines.append("## 源质量观察")
    lines.append(f"- Top 源：{json.dumps(source_quality_snapshot.get('top_sources', []), ensure_ascii=False)}")
    lines.append(f"- Bottom 源：{json.dumps(source_quality_snapshot.get('bottom_sources', []), ensure_ascii=False)}")
    lines.append("")

    flags = analysis.get("diagnostic_flags") or []
    if flags:
        lines.append("## 风险信号")
        for flag in flags:
            lines.append(f"- {flag}")
        lines.append("")

    lines.append("## 改进建议")
    ai_summary = str(improvement_actions.get("ai_summary", "")).strip()
    if ai_summary:
        lines.append(f"- AI 总结：{ai_summary}")
    for item in improvement_actions.get("rule_based_actions", []):
        lines.append(f"- 规则建议：{item}")
    for item in improvement_actions.get("ai_actions", []):
        lines.append(f"- AI 建议：{item}")
    lines.append("")

    dropped_items = dedupe_and_repeat.get("dropped_items", [])
    if isinstance(dropped_items, list) and dropped_items:
        lines.append("## 去重明细列表")
        lines.append(
            f"- 展示条数：{len(dropped_items)} / 总数 {dedupe_and_repeat.get('dropped_items_total', len(dropped_items))}"
        )
        for row in dropped_items:
            if not isinstance(row, dict):
                continue
            reason = str(row.get("reason", "")).strip() or "-"
            title = str(row.get("title", "")).strip() or "-"
            source_id = str(row.get("source_id", "")).strip() or "-"
            url = str(row.get("url", "")).strip() or "-"
            matched_title = str(row.get("matched_title", "")).strip() or "-"
            similarity = row.get("similarity", "")
            lines.append(
                f"- [{reason}] {title} | source={source_id} | similarity={similarity} | 命中={matched_title} | url={url}"
            )
        lines.append("")

    cap_skipped_items = dedupe_and_repeat.get("eval_cap_skipped_items", [])
    if isinstance(cap_skipped_items, list) and cap_skipped_items:
        lines.append("## 评估池截断列表")
        lines.append(
            f"- 展示条数：{len(cap_skipped_items)} / 总数 {dedupe_and_repeat.get('eval_cap_skipped_count', len(cap_skipped_items))}"
        )
        for row in cap_skipped_items:
            if not isinstance(row, dict):
                continue
            title = str(row.get("title", "")).strip() or "-"
            source_id = str(row.get("source_id", "")).strip() or "-"
            published_at = str(row.get("published_at", "")).strip() or "-"
            url = str(row.get("url", "")).strip() or "-"
            lines.append(f"- {title} | source={source_id} | published_at={published_at} | url={url}")
        lines.append("")

    return "\n".join(lines).rstrip() + "\n"


def write_analysis_markdown(content: str, report_date: str, output_dir: str = "reports") -> Path:
    path = Path(output_dir)
    path.mkdir(parents=True, exist_ok=True)
    output_file = path / f"{report_date}.analysis.md"
    output_file.write_text(content, encoding="utf-8")
    return output_file
