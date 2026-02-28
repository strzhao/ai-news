function percentile(values: number[], p: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  if (p <= 0) return sorted[0];
  if (p >= 100) return sorted[sorted.length - 1];
  const index = (sorted.length - 1) * (p / 100);
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sorted[lower];
  const weight = index - lower;
  return sorted[lower] * (1 - weight) + sorted[upper] * weight;
}

function toFloatList(values: unknown[]): number[] {
  const list: number[] = [];
  for (const value of values || []) {
    const n = Number(value);
    if (Number.isFinite(n)) list.push(n);
  }
  return list;
}

function roundFloat(value: number, digits = 2): number {
  const base = 10 ** digits;
  return Math.round(value * base) / base;
}

function buildRuleActions(analysis: Record<string, any>): string[] {
  const actions: string[] = [];
  const pipelineOverview = analysis.pipeline_overview || {};
  const qualityDistribution = analysis.quality_distribution || {};
  const selectionGates = analysis.selection_gates || {};
  const dedupeAndRepeat = analysis.dedupe_and_repeat || {};

  const selected = Number(pipelineOverview.selected_highlights_count || 0);
  const dedupedCount = Number(pipelineOverview.evaluation_pool_count || pipelineOverview.deduped_count || 0);
  const skipRate = Number(qualityDistribution.skip_rate || 0);
  const lowConfidence = Number((selectionGates.gate_skips || {}).low_confidence || 0);
  const repeatBlocked = Number((selectionGates.gate_skips || {}).repeat_limit_blocked || 0);
  const urlDups = Number(dedupeAndRepeat.url_duplicates || 0);
  const titleDups = Number(dedupeAndRepeat.title_duplicates || 0);

  if (dedupedCount > 0 && selected <= Math.max(2, Math.trunc(dedupedCount * 0.08))) {
    actions.push("重点文章入选偏低，建议下调 must_read 阈值或提高候选覆盖（增加高质量源抓取密度）。");
  }
  if (skipRate >= 0.7) {
    actions.push("跳过占比过高，建议收紧源池并增加 source_quality 低分源的惩罚。");
  }
  if (lowConfidence >= Math.max(5, Math.trunc(dedupedCount * 0.15))) {
    actions.push("低置信度落选较多，建议优化单篇评估提示词并增加失败重试上限。");
  }
  if (repeatBlocked > 0) {
    actions.push("重复限制已拦截候选，说明内容同质化明显，建议扩充来源多样性与主题覆盖。");
  }
  if (urlDups + titleDups >= Math.max(8, Math.trunc(dedupedCount * 0.2))) {
    actions.push("去重命中偏高，建议在抓取阶段强化聚合源去重和同源近似标题过滤。");
  }
  if (!actions.length) {
    actions.push("当前产线信号稳定，可保持阈值并持续观察 7 天滚动指标。");
  }
  return actions.slice(0, 8);
}

export function buildAnalysisJson(context: Record<string, unknown>): Record<string, unknown> {
  const pipelineOverview = (context.pipeline_overview || {}) as Record<string, unknown>;
  const qualityScores = toFloatList((context.quality_scores || []) as unknown[]);
  const confidenceScores = toFloatList((context.confidence_scores || []) as unknown[]);
  const worthCounts = ((context.worth_counts || {}) as Record<string, unknown>) || {};
  const typeCounts = ((context.type_counts || {}) as Record<string, unknown>) || {};

  const evaluatedCount = Number(context.evaluated_count || pipelineOverview.evaluated_count || 0);
  const skipCount = Number(worthCounts["跳过"] || 0);
  const skipRate = evaluatedCount > 0 ? skipCount / evaluatedCount : 0;

  const avgQuality = qualityScores.length ? qualityScores.reduce((a, b) => a + b, 0) / qualityScores.length : 0;
  const avgConfidence = confidenceScores.length
    ? confidenceScores.reduce((a, b) => a + b, 0) / confidenceScores.length
    : 0;

  const analysis: Record<string, any> = {
    report_date: String(context.report_date || ""),
    timezone: String(context.timezone || ""),
    generated_at: String(context.generated_at || new Date().toISOString()),
    pipeline_overview: pipelineOverview,
    quality_distribution: {
      worth_counts: worthCounts,
      type_counts: typeCounts,
      quality_percentiles: {
        p10: roundFloat(percentile(qualityScores, 10), 2),
        p25: roundFloat(percentile(qualityScores, 25), 2),
        p50: roundFloat(percentile(qualityScores, 50), 2),
        p75: roundFloat(percentile(qualityScores, 75), 2),
        p90: roundFloat(percentile(qualityScores, 90), 2),
      },
      confidence_percentiles: {
        p10: roundFloat(percentile(confidenceScores, 10), 3),
        p50: roundFloat(percentile(confidenceScores, 50), 3),
        p90: roundFloat(percentile(confidenceScores, 90), 3),
      },
      avg_quality: roundFloat(avgQuality, 2),
      avg_confidence: roundFloat(avgConfidence, 3),
      skip_rate: roundFloat(skipRate, 4),
    },
    selection_gates: context.selection_gates || {},
    dedupe_and_repeat: context.dedupe_and_repeat || {},
    personalization_impact: context.personalization_impact || {},
    source_quality_snapshot: context.source_quality_snapshot || {},
    diagnostic_flags: context.diagnostic_flags || [],
    improvement_actions: {
      rule_based_actions: [],
      ai_summary: "",
      ai_actions: [],
    },
  };

  analysis.improvement_actions.rule_based_actions = buildRuleActions(analysis);
  return analysis;
}

export function renderAnalysisMarkdown(analysis: Record<string, any>): string {
  const pipelineOverview = analysis.pipeline_overview || {};
  const qualityDistribution = analysis.quality_distribution || {};
  const selectionGates = analysis.selection_gates || {};
  const dedupeAndRepeat = analysis.dedupe_and_repeat || {};
  const personalization = analysis.personalization_impact || {};
  const sourceQualitySnapshot = analysis.source_quality_snapshot || {};
  const improvementActions = analysis.improvement_actions || {};

  const lines: string[] = [];
  const dedupedAfter = Number(pipelineOverview.deduped_after_dedupe || pipelineOverview.deduped_count || 0);
  const evalPool = Number(pipelineOverview.evaluation_pool_count || pipelineOverview.evaluated_count || 0);
  const maxEval = Number(pipelineOverview.max_eval_articles || 0);
  const evalCapSkipped = Number(pipelineOverview.eval_cap_skipped_count || 0);

  lines.push("## 诊断总览");
  lines.push(
    `- 报告日期：${analysis.report_date || "-"}（${analysis.timezone || "-"}），生成时间：${analysis.generated_at || "-"}`,
  );
  lines.push(
    `- 流水线规模：源 ${pipelineOverview.source_count || 0}，抓取 ${pipelineOverview.fetched_count || 0}，标准化 ${pipelineOverview.normalized_count || 0}，去重后 ${dedupedAfter}，评估池 ${evalPool}（上限 ${maxEval}，截断 ${evalCapSkipped}），评估 ${pipelineOverview.evaluated_count || 0}，入选 ${pipelineOverview.selected_highlights_count || 0}。`,
  );
  lines.push("");

  lines.push("## 质量分布");
  lines.push(`- worth 分布：${JSON.stringify(qualityDistribution.worth_counts || {}, undefined, 0)}`);
  lines.push(`- 类型分布：${JSON.stringify(qualityDistribution.type_counts || {}, undefined, 0)}`);
  lines.push(
    `- 质量分位：${JSON.stringify(qualityDistribution.quality_percentiles || {}, undefined, 0)}；平均质量 ${qualityDistribution.avg_quality || 0}。`,
  );
  lines.push(
    `- 置信度分位：${JSON.stringify(qualityDistribution.confidence_percentiles || {}, undefined, 0)}；平均置信度 ${qualityDistribution.avg_confidence || 0}，跳过占比 ${qualityDistribution.skip_rate || 0}。`,
  );
  lines.push("");

  lines.push("## 筛选闸门复盘");
  lines.push(`- 阈值快照：${JSON.stringify(selectionGates.thresholds || {}, undefined, 0)}`);
  lines.push(`- 落选计数：${JSON.stringify(selectionGates.gate_skips || {}, undefined, 0)}`);
  lines.push(`- 入选结构：${JSON.stringify(selectionGates.selection_mix || {}, undefined, 0)}`);
  lines.push("");

  lines.push("## 去重与重复限制");
  lines.push(`- URL 去重命中：${dedupeAndRepeat.url_duplicates || 0}，标题近似去重命中：${dedupeAndRepeat.title_duplicates || 0}。`);
  lines.push(
    `- 重复限制：enabled=${Boolean(dedupeAndRepeat.repeat_guard_enabled)}，max=${dedupeAndRepeat.max_info_dup || 0}，blocked=${dedupeAndRepeat.repeat_blocked || 0}。`,
  );
  lines.push(`- 评估池截断：max_eval=${maxEval}，超出未评估=${dedupeAndRepeat.eval_cap_skipped_count || 0}。`);
  lines.push("");

  lines.push("## 个性化影响");
  lines.push(`- 行为个性化：${JSON.stringify(personalization.behavior_summary || {}, undefined, 0)}`);
  lines.push(`- 类型个性化：${JSON.stringify(personalization.type_summary || {}, undefined, 0)}`);
  lines.push(`- 重排影响：${JSON.stringify(personalization.reorder_impact || {}, undefined, 0)}`);
  lines.push("");

  lines.push("## 源质量观察");
  lines.push(`- Top 源：${JSON.stringify(sourceQualitySnapshot.top_sources || [], undefined, 0)}`);
  lines.push(`- Bottom 源：${JSON.stringify(sourceQualitySnapshot.bottom_sources || [], undefined, 0)}`);
  lines.push("");

  const flags = Array.isArray(analysis.diagnostic_flags) ? analysis.diagnostic_flags : [];
  if (flags.length) {
    lines.push("## 风险信号");
    flags.forEach((flag: unknown) => {
      lines.push(`- ${String(flag)}`);
    });
    lines.push("");
  }

  lines.push("## 改进建议");
  const aiSummary = String(improvementActions.ai_summary || "").trim();
  if (aiSummary) {
    lines.push(`- AI 总结：${aiSummary}`);
  }
  (improvementActions.rule_based_actions || []).forEach((item: unknown) => lines.push(`- 规则建议：${String(item)}`));
  (improvementActions.ai_actions || []).forEach((item: unknown) => lines.push(`- AI 建议：${String(item)}`));
  lines.push("");

  return `${lines.join("\n").trimEnd()}\n`;
}
