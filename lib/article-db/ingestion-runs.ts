import { IngestionRunRow } from "@/lib/article-db/types";
import { getPgPool } from "@/lib/infra/postgres";
import { ensureArticleDbSchema } from "@/lib/article-db/repository";

function toIso(value: unknown): string {
  if (!value) return "";
  try {
    return new Date(String(value)).toISOString();
  } catch {
    return "";
  }
}

function toDateString(value: unknown): string {
  if (!value) return "";
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  const raw = String(value).trim();
  if (!raw) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return raw;
  }
  const parsed = new Date(raw);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toISOString().slice(0, 10);
  }
  return raw;
}

function parseStatsJson(value: unknown): Record<string, unknown> {
  if (!value) return {};
  if (typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return {};
    }
  }
  return {};
}

function parseIngestionRunRow(row: Record<string, unknown>): IngestionRunRow {
  return {
    id: String(row.id || ""),
    run_date: toDateString(row.run_date),
    status: String(row.status || ""),
    started_at: toIso(row.started_at),
    heartbeat_at: toIso(row.heartbeat_at),
    finished_at: toIso(row.finished_at),
    fetched_count: Number(row.fetched_count || 0),
    deduped_count: Number(row.deduped_count || 0),
    analyzed_count: Number(row.analyzed_count || 0),
    selected_count: Number(row.selected_count || 0),
    error_message: String(row.error_message || ""),
    stats_json: parseStatsJson(row.stats_json),
  };
}

export async function listRecentIngestionRuns(params: {
  days?: number;
  limit?: number;
} = {}): Promise<IngestionRunRow[]> {
  await ensureArticleDbSchema();
  const days = Math.max(1, Math.min(30, Math.trunc(params.days || 3)));
  const limit = Math.max(1, Math.min(168, Math.trunc(params.limit || 24)));
  const pool = getPgPool();
  const result = await pool.query(
    `
    SELECT *
    FROM ingestion_runs
    WHERE started_at >= NOW() - make_interval(days => $1::int)
    ORDER BY started_at DESC
    LIMIT $2
  `,
    [days, limit],
  );
  return result.rows.map((raw) => parseIngestionRunRow(raw as Record<string, unknown>));
}
