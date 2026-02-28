import { parseBoundedInt, RuntimeOptionInput, resolveRuntimeContext, resolveTrackerToken } from "../config";
import { CliError, isRecord } from "../errors";
import { requestJson } from "../http";
import { CommandResult, printSuccessLine } from "../output";
import { ensureRecord, throwForStatus } from "./common";

export interface StatsCommandOptions extends RuntimeOptionInput {
  days?: number;
  trackerToken?: string;
}

type StatsKind = "sources" | "types";

interface StatsRowSource {
  date: string;
  source_id: string;
  clicks: number;
}

interface StatsRowType {
  date: string;
  primary_type: string;
  clicks: number;
}

function normalizeDays(value: number | undefined): number {
  if (value === undefined) {
    return 90;
  }
  return parseBoundedInt("days", value, 1, 120);
}

function aggregateClicks(rows: Array<Record<string, unknown>>, keyField: string): Array<{ key: string; clicks: number }> {
  const map = new Map<string, number>();
  for (const row of rows) {
    const key = String(row[keyField] || "").trim();
    if (!key) {
      continue;
    }
    const clicks = Number(row.clicks || 0);
    const normalized = Number.isFinite(clicks) ? clicks : 0;
    map.set(key, (map.get(key) || 0) + normalized);
  }
  return Array.from(map.entries())
    .map(([key, clicks]) => ({ key, clicks }))
    .sort((a, b) => b.clicks - a.clicks || a.key.localeCompare(b.key));
}

async function executeStats(kind: StatsKind, options: StatsCommandOptions): Promise<CommandResult> {
  const runtime = resolveRuntimeContext(options);
  const token = resolveTrackerToken(options.trackerToken);
  if (!token) {
    throw new CliError(1, "缺少 tracker token，请传入 --tracker-token 或配置 AI_NEWS_TRACKER_TOKEN", {
      hint: "该 token 对应服务端 TRACKER_API_TOKEN",
    });
  }

  const days = normalizeDays(options.days);
  const response = await requestJson({
    baseUrl: runtime.baseUrl,
    path: kind === "sources" ? "/api/stats/sources" : "/api/stats/types",
    query: { days },
    headers: { Authorization: `Bearer ${token}` },
    timeoutMs: runtime.timeoutMs,
  });
  const payload = ensureRecord(response.data, `${kind} stats 接口返回格式异常`);
  throwForStatus(response.status, payload, response.url, "请检查 AI_NEWS_TRACKER_TOKEN 或 --tracker-token");

  const rowsUnknown = Array.isArray(payload.rows) ? payload.rows : [];
  const rows = rowsUnknown.filter(isRecord);
  const keyField = kind === "sources" ? "source_id" : "primary_type";
  const totals = aggregateClicks(rows, keyField);
  const totalClicks = totals.reduce((sum, item) => sum + item.clicks, 0);

  const lines = [
    printSuccessLine(`${kind === "sources" ? "来源" : "类型"}消费统计读取成功`),
    `days: ${String(payload.days || days)}`,
    `rows: ${rows.length}`,
    `total_clicks: ${totalClicks}`,
  ];
  for (const item of totals) {
    lines.push(`  - ${item.key}: ${item.clicks}`);
  }

  return {
    payload: {
      ...payload,
      summary: {
        rows: rows.length,
        total_clicks: totalClicks,
        totals,
      },
    },
    lines,
  };
}

export async function executeStatsSourcesCommand(options: StatsCommandOptions): Promise<CommandResult> {
  return executeStats("sources", options);
}

export async function executeStatsTypesCommand(options: StatsCommandOptions): Promise<CommandResult> {
  return executeStats("types", options);
}

export type { StatsRowSource, StatsRowType };
