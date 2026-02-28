import { RuntimeOptionInput, resolveCronToken, resolveRuntimeContext } from "../config";
import { CliError } from "../errors";
import { QueryValue, requestJson } from "../http";
import { CommandResult, printSuccessLine, printWarnLine } from "../output";
import { boolTo01, ensureOkField, ensureRecord, throwForStatus } from "./common";

export interface TriggerCommandOptions extends RuntimeOptionInput {
  token?: string;
  date?: string;
  topN?: number;
  maxEvalArticles?: number;
  archiveAnalysis?: boolean;
  ignoreRepeatLimit?: boolean;
  force?: boolean;
}

type TriggerRequestMode = "header" | "query_fallback" | "none";

function buildTriggerQuery(options: TriggerCommandOptions): Record<string, QueryValue> {
  return {
    date: options.date || undefined,
    top_n: options.topN,
    max_eval_articles: options.maxEvalArticles,
    archive_analysis: boolTo01(options.archiveAnalysis),
    ignore_repeat_limit: boolTo01(options.ignoreRepeatLimit),
  };
}

function formatMode(mode: TriggerRequestMode): string {
  if (mode === "header") return "Authorization Header";
  if (mode === "query_fallback") return "Query Token Fallback";
  return "No Auth";
}

export async function executeTriggerCommand(options: TriggerCommandOptions): Promise<CommandResult> {
  const runtime = resolveRuntimeContext(options);
  const token = resolveCronToken(options.token);
  const triggerTimeoutMs =
    options.timeoutMs === undefined && process.env.AI_NEWS_TIMEOUT_MS === undefined
      ? 300000
      : runtime.timeoutMs;
  if (options.ignoreRepeatLimit && !options.force) {
    throw new CliError(1, "ignore_repeat_limit 属于高风险参数，必须显式传入 --force", {
      hint: "示例：ai-news trigger --ignore-repeat-limit --force",
    });
  }

  const query = buildTriggerQuery(options);
  let requestMode: TriggerRequestMode = token ? "header" : "none";
  let response = await requestJson({
    baseUrl: runtime.baseUrl,
    path: "/api/cron_digest",
    query,
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    timeoutMs: triggerTimeoutMs,
  });

  if (response.status === 401 && token) {
    requestMode = "query_fallback";
    response = await requestJson({
      baseUrl: runtime.baseUrl,
      path: "/api/cron_digest",
      query: {
        ...query,
        token,
      },
      timeoutMs: triggerTimeoutMs,
    });
  }

  const payload = ensureRecord(response.data, "触发接口返回格式异常");
  throwForStatus(response.status, payload, response.url, "请检查 AI_NEWS_CRON_SECRET 或 --token");
  ensureOkField(payload, response.url);

  const resultPayload = {
    ...payload,
    request_mode: requestMode,
  };

  const lines = [
    printSuccessLine("日报触发成功"),
    `请求模式: ${formatMode(requestMode)}`,
    `报告日期: ${String(payload.report_date || "-")}`,
    `digest_id: ${String(payload.digest_id || "-")}`,
    `重点文章数: ${String(payload.highlight_count ?? "-")}`,
    `执行耗时(ms): ${String(payload.elapsed_ms ?? "-")}`,
    `归档写入: ${String(payload.archive_saved ?? false)}`,
    `分析归档: ${String(payload.analysis_archive_saved ?? false)}`,
  ];
  const archiveError = String(payload.archive_error || "").trim();
  if (archiveError) {
    lines.push(printWarnLine(`归档错误: ${archiveError}`));
  }
  return {
    payload: resultPayload,
    lines,
  };
}
