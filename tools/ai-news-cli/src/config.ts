import { CliError } from "./errors";

export interface RuntimeOptionInput {
  baseUrl?: string;
  timeoutMs?: number;
  json?: boolean;
}

export interface RuntimeContext {
  baseUrl: string;
  timeoutMs: number;
  json: boolean;
  cronSecret?: string;
  trackerToken?: string;
}

const DEFAULT_TIMEOUT_MS = 15000;

function normalizeString(value: unknown): string {
  return String(value ?? "").trim();
}

function normalizeBaseUrl(value: string): string {
  const raw = normalizeString(value);
  if (!raw) {
    throw new CliError(1, "缺少 base URL，请传入 --base-url 或配置 AI_NEWS_BASE_URL", {
      hint: "示例：--base-url https://ai-news.stringzhao.life",
    });
  }
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new CliError(1, `无效的 base URL: ${raw}`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new CliError(1, `base URL 仅支持 http/https: ${raw}`);
  }
  return raw.replace(/\/+$/, "");
}

function parseTimeout(raw: unknown): number {
  const text = normalizeString(raw);
  if (!text) {
    return DEFAULT_TIMEOUT_MS;
  }
  const value = Number.parseInt(text, 10);
  if (!Number.isFinite(value) || value <= 0) {
    throw new CliError(1, `无效的 timeout 值: ${text}`);
  }
  return value;
}

export function parseBoundedInt(
  label: string,
  value: unknown,
  min: number,
  max: number,
): number {
  const text = normalizeString(value);
  const parsed = Number.parseInt(text, 10);
  if (!Number.isFinite(parsed)) {
    throw new CliError(1, `${label} 不是合法整数: ${text}`);
  }
  if (parsed < min || parsed > max) {
    throw new CliError(1, `${label} 超出范围，要求 ${min}-${max}: ${parsed}`);
  }
  return parsed;
}

export function resolveRuntimeContext(options: RuntimeOptionInput): RuntimeContext {
  const baseUrl = normalizeBaseUrl(options.baseUrl || process.env.AI_NEWS_BASE_URL || process.env.TRACKER_BASE_URL || "");
  const timeoutMs = parseTimeout(options.timeoutMs ?? process.env.AI_NEWS_TIMEOUT_MS);
  const json = Boolean(options.json);
  const cronSecret = normalizeString(process.env.AI_NEWS_CRON_SECRET || process.env.CRON_SECRET) || undefined;
  const trackerToken = normalizeString(process.env.AI_NEWS_TRACKER_TOKEN || process.env.TRACKER_API_TOKEN) || undefined;
  return {
    baseUrl,
    timeoutMs,
    json,
    cronSecret,
    trackerToken,
  };
}

export function resolveCronToken(explicit?: string): string | undefined {
  const value = normalizeString(explicit) || normalizeString(process.env.AI_NEWS_CRON_SECRET || process.env.CRON_SECRET);
  return value || undefined;
}

export function resolveTrackerToken(explicit?: string): string | undefined {
  const value =
    normalizeString(explicit) ||
    normalizeString(process.env.AI_NEWS_TRACKER_TOKEN || process.env.TRACKER_API_TOKEN);
  return value || undefined;
}
