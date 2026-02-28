import { parseBoundedInt, RuntimeOptionInput, resolveRuntimeContext } from "../config";
import { CliError } from "../errors";
import { requestJson } from "../http";
import { CommandResult, printSuccessLine } from "../output";
import { ensureOkField, ensureRecord, throwForStatus } from "./common";

export interface ArchiveListCommandOptions extends RuntimeOptionInput {
  days?: number;
  limitPerDay?: number;
}

export interface ArchiveItemCommandOptions extends RuntimeOptionInput {
  id?: string;
  rawMarkdown?: boolean;
}

function normalizeDays(value: number | undefined): number {
  if (value === undefined) {
    return 30;
  }
  return parseBoundedInt("days", value, 1, 180);
}

function normalizeLimitPerDay(value: number | undefined): number {
  if (value === undefined) {
    return 10;
  }
  return parseBoundedInt("limit-per-day", value, 1, 50);
}

function normalizeDigestId(value: string | undefined): string {
  const normalized = String(value || "").trim();
  if (!normalized) {
    throw new CliError(1, "缺少 digest_id，请传入 --id");
  }
  return normalized;
}

export async function executeArchiveListCommand(options: ArchiveListCommandOptions): Promise<CommandResult> {
  const runtime = resolveRuntimeContext(options);
  const days = normalizeDays(options.days);
  const limitPerDay = normalizeLimitPerDay(options.limitPerDay);
  const response = await requestJson({
    baseUrl: runtime.baseUrl,
    path: "/api/archive",
    query: {
      days,
      limit_per_day: limitPerDay,
    },
    timeoutMs: runtime.timeoutMs,
  });
  const payload = ensureRecord(response.data, "archive 接口返回格式异常");
  throwForStatus(response.status, payload, response.url);
  ensureOkField(payload, response.url);

  const groups = Array.isArray(payload.groups) ? payload.groups : [];
  let totalItems = 0;
  const lines = [
    printSuccessLine(`归档读取成功（days=${String(payload.days || days)} limit_per_day=${String(payload.limit_per_day || limitPerDay)}）`),
  ];
  for (const group of groups) {
    const groupObj = ensureRecord(group, "archive groups 数据异常");
    const date = String(groupObj.date || "-");
    const items = Array.isArray(groupObj.items) ? groupObj.items : [];
    totalItems += items.length;
    lines.push(`${date} (${items.length} 份)`);
    for (const item of items) {
      const itemObj = ensureRecord(item, "archive item 数据异常");
      lines.push(
        `  - ${String(itemObj.generated_at || "-")} | digest_id=${String(itemObj.digest_id || "-")} | highlights=${String(itemObj.highlight_count ?? "-")}`,
      );
    }
  }
  lines.push(`总计: ${groups.length} 天, ${totalItems} 份`);
  return {
    payload: {
      ...payload,
      summary: {
        group_count: groups.length,
        item_count: totalItems,
      },
    },
    lines,
  };
}

export async function executeArchiveItemCommand(options: ArchiveItemCommandOptions): Promise<CommandResult> {
  const runtime = resolveRuntimeContext(options);
  const digestId = normalizeDigestId(options.id);
  const response = await requestJson({
    baseUrl: runtime.baseUrl,
    path: "/api/archive_item",
    query: {
      id: digestId,
    },
    timeoutMs: runtime.timeoutMs,
  });
  const payload = ensureRecord(response.data, "archive_item 接口返回格式异常");
  throwForStatus(response.status, payload, response.url);
  ensureOkField(payload, response.url);
  const item = ensureRecord(payload.item, "archive_item.item 返回异常");
  const markdown = String(item.markdown || "");

  if (options.rawMarkdown) {
    return {
      payload: {
        ...payload,
      },
      rawText: markdown,
    };
  }

  return {
    payload: payload,
    lines: [
      printSuccessLine("日报正文读取成功"),
      `digest_id: ${String(item.digest_id || digestId)}`,
      `date: ${String(item.date || "-")}`,
      `generated_at: ${String(item.generated_at || "-")}`,
      `highlight_count: ${String(item.highlight_count ?? "-")}`,
      "",
      markdown,
    ],
  };
}

export async function executeArchiveAnalysisCommand(options: ArchiveItemCommandOptions): Promise<CommandResult> {
  const runtime = resolveRuntimeContext(options);
  const digestId = normalizeDigestId(options.id);
  const response = await requestJson({
    baseUrl: runtime.baseUrl,
    path: "/api/archive_analysis",
    query: {
      id: digestId,
    },
    timeoutMs: runtime.timeoutMs,
  });
  const payload = ensureRecord(response.data, "archive_analysis 接口返回格式异常");
  throwForStatus(response.status, payload, response.url);
  ensureOkField(payload, response.url);
  const item = ensureRecord(payload.item, "archive_analysis.item 返回异常");
  const markdown = String(item.analysis_markdown || "");

  if (options.rawMarkdown) {
    return {
      payload: {
        ...payload,
      },
      rawText: markdown,
    };
  }

  return {
    payload: payload,
    lines: [
      printSuccessLine("分析报告读取成功"),
      `digest_id: ${String(item.digest_id || digestId)}`,
      `date: ${String(item.date || "-")}`,
      `generated_at: ${String(item.generated_at || "-")}`,
      "",
      markdown,
    ],
  };
}
