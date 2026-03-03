import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/v1/flomo/push-from-archive-articles/route";

const {
  sendMock,
  fetchFlomoNextPushBatchMock,
  markFlomoPushBatchSentMock,
  markFlomoPushBatchFailedMock,
} = vi.hoisted(() => {
  return {
    sendMock: vi.fn(),
    fetchFlomoNextPushBatchMock: vi.fn(),
    markFlomoPushBatchSentMock: vi.fn(),
    markFlomoPushBatchFailedMock: vi.fn(),
  };
});

vi.mock("@/lib/integrations/article-db-client", () => {
  return {
    fetchFlomoNextPushBatch: (...args: unknown[]) => fetchFlomoNextPushBatchMock(...args),
    markFlomoPushBatchSent: (...args: unknown[]) => markFlomoPushBatchSentMock(...args),
    markFlomoPushBatchFailed: (...args: unknown[]) => markFlomoPushBatchFailedMock(...args),
  };
});

vi.mock("@/lib/integrations/flomo-client", () => {
  return {
    FlomoSyncError: class FlomoSyncError extends Error {},
    FlomoClient: class FlomoClient {
      async send(payload: unknown): Promise<void> {
        await sendMock(payload);
      }
    },
  };
});

describe("flomo push from archive_articles route", () => {
  beforeEach(() => {
    fetchFlomoNextPushBatchMock.mockResolvedValue({
      ok: true,
      generatedAt: "2026-03-01T00:00:00.000Z",
      reportDate: "2026-03-01",
      sourceDate: "2026-03-01",
      timezone: "Asia/Shanghai",
      qualityTier: "high",
      hasBatch: true,
      retryingBatch: false,
      batchKey: "archive-articles-2026-03-01-batch",
      articleCount: 2,
      tagCount: 3,
      content: "batch-content",
      reason: "",
    });
    markFlomoPushBatchSentMock.mockResolvedValue({
      consumedCount: 2,
    });
    markFlomoPushBatchFailedMock.mockResolvedValue(undefined);
    sendMock.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.clearAllMocks();
    delete process.env.CRON_SECRET;
  });

  it("returns 401 when cron secret does not match", async () => {
    process.env.CRON_SECRET = "expected";

    const response = await GET(new Request("https://example.com/api/v1/flomo/push-from-archive-articles?token=wrong"));
    const payload = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(401);
    expect(payload.ok).toBe(false);
    expect(fetchFlomoNextPushBatchMock).not.toHaveBeenCalled();
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("returns sent=false when no candidate batch is available", async () => {
    process.env.CRON_SECRET = "expected";
    fetchFlomoNextPushBatchMock.mockResolvedValue({
      ok: true,
      generatedAt: "2026-03-01T00:00:00.000Z",
      reportDate: "2026-03-01",
      sourceDate: "2026-03-01",
      timezone: "Asia/Shanghai",
      qualityTier: "high",
      hasBatch: false,
      retryingBatch: false,
      batchKey: "",
      articleCount: 0,
      tagCount: 0,
      content: "",
      reason: "No unconsumed high-quality archive articles found",
    });

    const response = await GET(
      new Request("https://example.com/api/v1/flomo/push-from-archive-articles?date=2026-03-01", {
        headers: {
          Authorization: "Bearer expected",
        },
      }),
    );
    const payload = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(payload.ok).toBe(true);
    expect(payload.sent).toBe(false);
    expect(payload.reason).toBe("No unconsumed high-quality archive articles found");
    expect(sendMock).not.toHaveBeenCalled();
    expect(markFlomoPushBatchSentMock).not.toHaveBeenCalled();
  });

  it("pushes flomo using analysis service batch and marks consumed on success", async () => {
    process.env.CRON_SECRET = "expected";

    const response = await GET(
      new Request(
        "https://example.com/api/v1/flomo/push-from-archive-articles?token=expected&days=10&limit_per_day=12&article_limit_per_day=50&quality_tier=all&tz=UTC",
      ),
    );
    const payload = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(payload.ok).toBe(true);
    expect(payload.sent).toBe(true);
    expect(payload.batch_key).toBe("archive-articles-2026-03-01-batch");
    expect(payload.article_count).toBe(2);
    expect(payload.consumed_count).toBe(2);
    expect(fetchFlomoNextPushBatchMock).toHaveBeenCalledWith({
      date: undefined,
      tz: "UTC",
      days: 10,
      limitPerDay: 12,
      articleLimitPerDay: 50,
      qualityTier: "all",
    });
    expect(sendMock).toHaveBeenCalledWith({
      content: "batch-content",
      dedupeKey: "archive-articles-2026-03-01-batch",
    });
    expect(markFlomoPushBatchSentMock).toHaveBeenCalledWith("archive-articles-2026-03-01-batch");
    expect(markFlomoPushBatchFailedMock).not.toHaveBeenCalled();
  });

  it("marks batch as failed when flomo delivery fails", async () => {
    process.env.CRON_SECRET = "expected";
    sendMock.mockRejectedValue(new Error("flomo timeout"));

    const response = await GET(
      new Request("https://example.com/api/v1/flomo/push-from-archive-articles?token=expected"),
    );
    const payload = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(500);
    expect(payload.ok).toBe(false);
    expect(payload.sent).toBe(false);
    expect(markFlomoPushBatchSentMock).not.toHaveBeenCalled();
    expect(markFlomoPushBatchFailedMock).toHaveBeenCalledWith(
      "archive-articles-2026-03-01-batch",
      "flomo timeout",
    );
  });
});
