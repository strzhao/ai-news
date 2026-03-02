import { IngestionRunRow } from "@/lib/article-db/types";

export interface AiEvalFailedSample {
  article_id: string;
  source_id: string;
  error_type: string;
  error_message: string;
  truncated_model_output: string;
}

export interface AiEvalRunView {
  run_id: string;
  run_date: string;
  status: string;
  started_at: string;
  finished_at: string;
  fetched_count: number;
  deduped_count: number;
  analyzed_count: number;
  selected_count: number;
  error_message: string;
  ai_eval_total_candidates: number;
  ai_eval_evaluated_success: number;
  ai_eval_evaluated_failed: number;
  ai_eval_skipped_due_wall_time: number;
  ai_eval_failed_rate: number;
  ai_eval_cache_hit: number;
  ai_eval_cache_miss: number;
  ai_eval_cache_hit_rate: number;
  ai_eval_retry_count_total: number;
  ai_eval_latency_ms_p50: number;
  ai_eval_latency_ms_p90: number;
  ai_eval_latency_ms_max: number;
  ai_eval_error_type_counts: Record<string, number>;
  ai_eval_failed_samples_count: number;
  ai_eval_failed_samples: AiEvalFailedSample[];
  ai_eval_model_name: string;
  ai_eval_prompt_version: string;
}

export interface AiEvalSummary {
  run_count: number;
  run_success_count: number;
  run_failed_count: number;
  run_success_rate: number;
  ai_eval_total_candidates: number;
  ai_eval_total_success: number;
  ai_eval_total_failed: number;
  ai_eval_failed_rate_avg: number;
  ai_eval_cache_hit_rate_avg: number;
  ai_eval_latency_p90_ms_avg: number;
  latest_started_at: string;
  latest_finished_at: string;
}

export interface AiEvalObservabilitySnapshot {
  summary: AiEvalSummary;
  runs: AiEvalRunView[];
  latest_failed_samples: AiEvalFailedSample[];
}

function boundedRate(numerator: number, denominator: number): number {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) {
    return 0;
  }
  return Number((numerator / denominator).toFixed(4));
}

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function toNumber(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return parsed;
}

function parseErrorTypeCounts(value: unknown): Record<string, number> {
  const input = asObject(value);
  const output: Record<string, number> = {};
  Object.entries(input).forEach(([key, raw]) => {
    const normalizedKey = String(key || "").trim().toLowerCase();
    if (!normalizedKey) return;
    output[normalizedKey] = Math.max(0, Math.trunc(toNumber(raw, 0)));
  });
  return output;
}

function parseFailedSamples(value: unknown): AiEvalFailedSample[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        return null;
      }
      const row = item as Record<string, unknown>;
      const articleId = String(row.article_id || "").trim();
      if (!articleId) return null;
      return {
        article_id: articleId,
        source_id: String(row.source_id || "").trim(),
        error_type: String(row.error_type || "unknown_error").trim() || "unknown_error",
        error_message: String(row.error_message || "").trim(),
        truncated_model_output: String(row.truncated_model_output || "").trim(),
      };
    })
    .filter((item): item is AiEvalFailedSample => Boolean(item));
}

export function normalizeAiEvalRun(run: IngestionRunRow): AiEvalRunView {
  const stats = asObject(run.stats_json);
  const failedSamples = parseFailedSamples(stats.ai_eval_failed_samples);
  const cacheHit = Math.max(0, Math.trunc(toNumber(stats.ai_eval_cache_hit, 0)));
  const cacheMiss = Math.max(0, Math.trunc(toNumber(stats.ai_eval_cache_miss, 0)));
  const totalCandidates = Math.max(0, Math.trunc(toNumber(stats.ai_eval_total_candidates, 0)));
  const evalSuccess = Math.max(0, Math.trunc(toNumber(stats.ai_eval_evaluated_success, 0)));
  const evalFailed = Math.max(0, Math.trunc(toNumber(stats.ai_eval_evaluated_failed, 0)));

  return {
    run_id: run.id,
    run_date: run.run_date,
    status: run.status,
    started_at: run.started_at,
    finished_at: run.finished_at,
    fetched_count: Math.max(0, Math.trunc(run.fetched_count || 0)),
    deduped_count: Math.max(0, Math.trunc(run.deduped_count || 0)),
    analyzed_count: Math.max(0, Math.trunc(run.analyzed_count || 0)),
    selected_count: Math.max(0, Math.trunc(run.selected_count || 0)),
    error_message: String(run.error_message || "").trim(),
    ai_eval_total_candidates: totalCandidates,
    ai_eval_evaluated_success: evalSuccess,
    ai_eval_evaluated_failed: evalFailed,
    ai_eval_skipped_due_wall_time: Math.max(0, Math.trunc(toNumber(stats.ai_eval_skipped_due_wall_time, 0))),
    ai_eval_failed_rate: boundedRate(evalFailed, Math.max(1, evalSuccess + evalFailed)),
    ai_eval_cache_hit: cacheHit,
    ai_eval_cache_miss: cacheMiss,
    ai_eval_cache_hit_rate: boundedRate(cacheHit, Math.max(1, cacheHit + cacheMiss)),
    ai_eval_retry_count_total: Math.max(0, Math.trunc(toNumber(stats.ai_eval_retry_count_total, 0))),
    ai_eval_latency_ms_p50: Math.max(0, Math.round(toNumber(stats.ai_eval_latency_ms_p50, 0))),
    ai_eval_latency_ms_p90: Math.max(0, Math.round(toNumber(stats.ai_eval_latency_ms_p90, 0))),
    ai_eval_latency_ms_max: Math.max(0, Math.round(toNumber(stats.ai_eval_latency_ms_max, 0))),
    ai_eval_error_type_counts: parseErrorTypeCounts(stats.ai_eval_error_type_counts),
    ai_eval_failed_samples_count: failedSamples.length,
    ai_eval_failed_samples: failedSamples,
    ai_eval_model_name: String(stats.ai_eval_model_name || "").trim(),
    ai_eval_prompt_version: String(stats.ai_eval_prompt_version || "").trim(),
  };
}

export function buildAiEvalObservabilitySnapshot(runs: IngestionRunRow[]): AiEvalObservabilitySnapshot {
  const normalizedRuns = runs.map((run) => normalizeAiEvalRun(run));
  const runCount = normalizedRuns.length;
  const runSuccessCount = normalizedRuns.filter((run) => run.status === "success").length;
  const runFailedCount = normalizedRuns.filter((run) => run.status === "failed").length;

  const totalCandidates = normalizedRuns.reduce((sum, run) => sum + run.ai_eval_total_candidates, 0);
  const totalSuccess = normalizedRuns.reduce((sum, run) => sum + run.ai_eval_evaluated_success, 0);
  const totalFailed = normalizedRuns.reduce((sum, run) => sum + run.ai_eval_evaluated_failed, 0);

  const failedRateRuns = normalizedRuns.filter((run) => run.ai_eval_evaluated_success + run.ai_eval_evaluated_failed > 0);
  const cacheRateRuns = normalizedRuns.filter((run) => run.ai_eval_cache_hit + run.ai_eval_cache_miss > 0);
  const latencyRuns = normalizedRuns.filter((run) => run.ai_eval_latency_ms_p90 > 0);

  const avgFailedRate = failedRateRuns.length
    ? Number(
        (
          failedRateRuns.reduce((sum, run) => sum + run.ai_eval_failed_rate, 0) /
          failedRateRuns.length
        ).toFixed(4),
      )
    : 0;
  const avgCacheHitRate = cacheRateRuns.length
    ? Number(
        (
          cacheRateRuns.reduce((sum, run) => sum + run.ai_eval_cache_hit_rate, 0) /
          cacheRateRuns.length
        ).toFixed(4),
      )
    : 0;
  const avgLatencyP90Ms = latencyRuns.length
    ? Math.round(latencyRuns.reduce((sum, run) => sum + run.ai_eval_latency_ms_p90, 0) / latencyRuns.length)
    : 0;

  const latestFailedSamples = normalizedRuns.find((run) => run.ai_eval_failed_samples.length > 0)?.ai_eval_failed_samples || [];

  return {
    summary: {
      run_count: runCount,
      run_success_count: runSuccessCount,
      run_failed_count: runFailedCount,
      run_success_rate: boundedRate(runSuccessCount, Math.max(1, runCount)),
      ai_eval_total_candidates: totalCandidates,
      ai_eval_total_success: totalSuccess,
      ai_eval_total_failed: totalFailed,
      ai_eval_failed_rate_avg: avgFailedRate,
      ai_eval_cache_hit_rate_avg: avgCacheHitRate,
      ai_eval_latency_p90_ms_avg: avgLatencyP90Ms,
      latest_started_at: normalizedRuns[0]?.started_at || "",
      latest_finished_at: normalizedRuns[0]?.finished_at || "",
    },
    runs: normalizedRuns,
    latest_failed_samples: latestFailedSamples,
  };
}
