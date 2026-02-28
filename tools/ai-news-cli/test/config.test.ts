import { afterEach, describe, expect, it } from "vitest";

import { parseBoundedInt, resolveCronToken, resolveRuntimeContext, resolveTrackerToken } from "../src/config";

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("config", () => {
  it("loads base url and timeout from env", () => {
    process.env.AI_NEWS_BASE_URL = "https://ai-news.stringzhao.life/";
    process.env.AI_NEWS_TIMEOUT_MS = "12000";

    const runtime = resolveRuntimeContext({});
    expect(runtime.baseUrl).toBe("https://ai-news.stringzhao.life");
    expect(runtime.timeoutMs).toBe(12000);
  });

  it("throws when base url is missing", () => {
    delete process.env.AI_NEWS_BASE_URL;
    expect(() => resolveRuntimeContext({})).toThrowError(/base URL/);
  });

  it("parses bounded integers", () => {
    expect(parseBoundedInt("days", 7, 1, 180)).toBe(7);
  });

  it("supports CRON_SECRET fallback", () => {
    process.env.CRON_SECRET = "cron-secret";
    delete process.env.AI_NEWS_CRON_SECRET;
    expect(resolveCronToken(undefined)).toBe("cron-secret");
  });

  it("supports TRACKER_API_TOKEN fallback", () => {
    process.env.TRACKER_API_TOKEN = "tracker-secret";
    delete process.env.AI_NEWS_TRACKER_TOKEN;
    expect(resolveTrackerToken(undefined)).toBe("tracker-secret");
  });
});
