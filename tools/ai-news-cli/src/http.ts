import { CliError } from "./errors";

export type QueryValue = string | number | boolean | null | undefined;

export interface RequestJsonOptions {
  baseUrl: string;
  path: string;
  query?: Record<string, QueryValue>;
  headers?: Record<string, string>;
  timeoutMs: number;
  method?: "GET";
}

export interface JsonResponse<T> {
  status: number;
  url: string;
  data: T;
}

function buildUrl(baseUrl: string, path: string, query: Record<string, QueryValue> = {}): string {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  const url = new URL(`${baseUrl}${normalizedPath}`);
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) {
      continue;
    }
    const normalized = String(value).trim();
    if (!normalized) {
      continue;
    }
    url.searchParams.set(key, normalized);
  }
  return url.toString();
}

export async function requestJson<T = Record<string, unknown>>(
  options: RequestJsonOptions,
): Promise<JsonResponse<T>> {
  const url = buildUrl(options.baseUrl, options.path, options.query);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs);

  try {
    const response = await fetch(url, {
      method: options.method || "GET",
      headers: options.headers,
      signal: controller.signal,
    });
    const text = await response.text();
    let data: T = {} as T;
    if (text.trim()) {
      try {
        data = JSON.parse(text) as T;
      } catch {
        throw new CliError(4, "接口返回了非 JSON 内容", {
          status: response.status,
          endpoint: url,
          details: text.slice(0, 300),
        });
      }
    }
    return {
      status: response.status,
      url,
      data,
    };
  } catch (error) {
    if (error instanceof CliError) {
      throw error;
    }
    if (error instanceof Error && error.name === "AbortError") {
      throw new CliError(2, `请求超时（>${options.timeoutMs}ms）`, {
        endpoint: url,
      });
    }
    throw new CliError(2, "网络请求失败", {
      endpoint: url,
      details: error instanceof Error ? error.message : String(error),
    });
  } finally {
    clearTimeout(timer);
  }
}
