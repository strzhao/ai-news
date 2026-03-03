import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/v1/flomo/push-from-archive-articles/route";
import { listArchiveArticles } from "@/lib/domain/archive-articles";

const {
  sendMock,
  tryAcquireFlomoArchivePushLockMock,
  releaseFlomoArchivePushLockMock,
  getNextRetryableFlomoArchivePushBatchMock,
  listConsumedFlomoArchiveArticleIdsMock,
  createFlomoArchivePushBatchMock,
  markFlomoArchivePushBatchSentMock,
  markFlomoArchivePushBatchFailedMock,
} = vi.hoisted(() => {
  return {
    sendMock: vi.fn(),
    tryAcquireFlomoArchivePushLockMock: vi.fn(),
    releaseFlomoArchivePushLockMock: vi.fn(),
    getNextRetryableFlomoArchivePushBatchMock: vi.fn(),
    listConsumedFlomoArchiveArticleIdsMock: vi.fn(),
    createFlomoArchivePushBatchMock: vi.fn(),
    markFlomoArchivePushBatchSentMock: vi.fn(),
    markFlomoArchivePushBatchFailedMock: vi.fn(),
  };
});

vi.mock("@/lib/domain/archive-articles", () => {
  return {
    listArchiveArticles: vi.fn(),
  };
});

vi.mock("@/lib/article-db/repository", () => {
  return {
    tryAcquireFlomoArchivePushLock: (...args: unknown[]) => tryAcquireFlomoArchivePushLockMock(...args),
    releaseFlomoArchivePushLock: (...args: unknown[]) => releaseFlomoArchivePushLockMock(...args),
    getNextRetryableFlomoArchivePushBatch: (...args: unknown[]) => getNextRetryableFlomoArchivePushBatchMock(...args),
    listConsumedFlomoArchiveArticleIds: (...args: unknown[]) => listConsumedFlomoArchiveArticleIdsMock(...args),
    createFlomoArchivePushBatch: (...args: unknown[]) => createFlomoArchivePushBatchMock(...args),
    markFlomoArchivePushBatchSent: (...args: unknown[]) => markFlomoArchivePushBatchSentMock(...args),
    markFlomoArchivePushBatchFailed: (...args: unknown[]) => markFlomoArchivePushBatchFailedMock(...args),
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
    tryAcquireFlomoArchivePushLockMock.mockResolvedValue(true);
    releaseFlomoArchivePushLockMock.mockResolvedValue(undefined);
    getNextRetryableFlomoArchivePushBatchMock.mockResolvedValue(null);
    listConsumedFlomoArchiveArticleIdsMock.mockResolvedValue(new Set<string>());
    createFlomoArchivePushBatchMock.mockResolvedValue(undefined);
    markFlomoArchivePushBatchSentMock.mockResolvedValue(0);
    markFlomoArchivePushBatchFailedMock.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.clearAllMocks();
    delete process.env.CRON_SECRET;
    delete process.env.FLOMO_H5_URL;
    delete process.env.TRACKER_BASE_URL;
    delete process.env.TRACKER_SIGNING_SECRET;
  });

  it("returns 401 when cron secret does not match", async () => {
    process.env.CRON_SECRET = "expected";

    const response = await GET(new Request("https://example.com/api/v1/flomo/push-from-archive-articles?token=wrong"));
    const payload = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(401);
    expect(payload.ok).toBe(false);
    expect(listArchiveArticles).not.toHaveBeenCalled();
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("returns sent=false when no unconsumed article is available", async () => {
    process.env.CRON_SECRET = "expected";
    vi.mocked(listArchiveArticles).mockResolvedValue({
      totalArticles: 0,
      groups: [],
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
    expect(payload.article_count).toBe(0);
    expect(payload.reason).toBe("No unconsumed high-quality archive articles found");
    expect(sendMock).not.toHaveBeenCalled();
    expect(createFlomoArchivePushBatchMock).not.toHaveBeenCalled();
  });

  it("falls back to older date when latest group is already consumed", async () => {
    process.env.CRON_SECRET = "expected";
    process.env.FLOMO_H5_URL = "https://ai-news.example.com";
    process.env.TRACKER_BASE_URL = "https://tracker.example.com";
    process.env.TRACKER_SIGNING_SECRET = "tracker-secret";
    vi.mocked(listArchiveArticles).mockResolvedValue({
      totalArticles: 2,
      groups: [
        {
          date: "2026-03-02",
          items: [
            {
              article_id: "a2",
              title: "Second title",
              url: "https://example.com/a2",
              summary: "第二篇摘要",
              image_url: "",
              source_host: "example.com",
              date: "2026-03-02",
              digest_id: "d2",
              generated_at: "2026-03-02T00:00:00.000Z",
            },
          ],
        },
        {
          date: "2026-03-01",
          items: [
            {
              article_id: "a1",
              title: "First title",
              url: "https://example.com/a1",
              summary: "第一篇摘要",
              image_url: "",
              source_host: "example.com",
              date: "2026-03-01",
              digest_id: "d1",
              generated_at: "2026-03-01T00:00:00.000Z",
            },
          ],
        },
      ],
    });
    listConsumedFlomoArchiveArticleIdsMock.mockResolvedValue(new Set(["a2"]));
    markFlomoArchivePushBatchSentMock.mockResolvedValue(1);

    const response = await GET(
      new Request("https://example.com/api/v1/flomo/push-from-archive-articles?token=expected"),
    );
    const payload = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(payload.ok).toBe(true);
    expect(payload.sent).toBe(true);
    expect(payload.article_count).toBe(1);
    expect(payload.source_date).toBe("2026-03-01");
    expect(payload.retrying_batch).toBe(false);
    expect(payload.consumed_count).toBe(1);
    expect(listArchiveArticles).toHaveBeenCalledWith({
      days: 30,
      limitPerDay: 30,
      articleLimitPerDay: 30,
      imageProbeLimit: 0,
      qualityTier: "high",
    });
    expect(createFlomoArchivePushBatchMock).toHaveBeenCalledTimes(1);
    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(markFlomoArchivePushBatchSentMock).toHaveBeenCalledTimes(1);
    expect(markFlomoArchivePushBatchFailedMock).not.toHaveBeenCalled();

    const sentPayload = sendMock.mock.calls[0]?.[0] as { content: string; dedupeKey: string };
    expect(String(sentPayload.dedupeKey || "")).toMatch(/^archive-articles-2026-03-01-/);
    expect(sentPayload.dedupeKey).toBe(payload.batch_key);
    expect(sentPayload.content).toContain("【重点文章】");
    expect(sentPayload.content).toContain("1. First title");
    expect(sentPayload.content).not.toContain("2. Second title");
    expect(sentPayload.content).not.toContain("日期：");
    expect(sentPayload.content).not.toContain("今日共");
    expect(sentPayload.content).toContain("https://tracker.example.com/api/r?");
    expect(sentPayload.content).toContain("sid=example.com");
    expect(sentPayload.content).toContain("aid=a1");
    expect(sentPayload.content).toContain("d=2026-03-01");
    expect(sentPayload.content).toContain("ch=flomo");
    expect(sentPayload.content).toContain("sig=");
    expect(sentPayload.content).toContain("查看更多：https://ai-news.example.com/");
  });

  it("uses explicit date when provided", async () => {
    process.env.CRON_SECRET = "expected";
    vi.mocked(listArchiveArticles).mockResolvedValue({
      totalArticles: 2,
      groups: [
        {
          date: "2026-03-02",
          items: [
            {
              article_id: "a2",
              title: "Latest",
              url: "https://example.com/a2",
              summary: "latest",
              image_url: "",
              source_host: "example.com",
              date: "2026-03-02",
              digest_id: "d2",
              generated_at: "2026-03-02T00:00:00.000Z",
            },
          ],
        },
        {
          date: "2026-03-01",
          items: [
            {
              article_id: "a1",
              title: "Target",
              url: "https://example.com/a1",
              summary: "target",
              image_url: "",
              source_host: "example.com",
              date: "2026-03-01",
              digest_id: "d1",
              generated_at: "2026-03-01T00:00:00.000Z",
            },
          ],
        },
      ],
    });
    markFlomoArchivePushBatchSentMock.mockResolvedValue(1);

    const response = await GET(
      new Request("https://example.com/api/v1/flomo/push-from-archive-articles?token=expected&date=2026-03-01"),
    );
    const payload = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(payload.ok).toBe(true);
    expect(payload.sent).toBe(true);
    expect(payload.source_date).toBe("2026-03-01");

    const sentPayload = sendMock.mock.calls[0]?.[0] as { content: string };
    expect(sentPayload.content).toContain("1. Target");
    expect(sentPayload.content).not.toContain("Latest");
  });

  it("retries pending/failed batch before selecting new group", async () => {
    process.env.CRON_SECRET = "expected";
    getNextRetryableFlomoArchivePushBatchMock.mockResolvedValue({
      batchKey: "archive-articles-2026-03-01-fixed",
      sourceDate: "2026-03-01",
      status: "failed",
      articleIds: ["a1"],
      payloadContent: "retry content",
      createdAt: "2026-03-01T00:00:00.000Z",
      sentAt: "",
      lastError: "temporary error",
    });
    markFlomoArchivePushBatchSentMock.mockResolvedValue(1);

    const response = await GET(
      new Request("https://example.com/api/v1/flomo/push-from-archive-articles?token=expected"),
    );
    const payload = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(payload.ok).toBe(true);
    expect(payload.sent).toBe(true);
    expect(payload.retrying_batch).toBe(true);
    expect(payload.batch_key).toBe("archive-articles-2026-03-01-fixed");
    expect(listArchiveArticles).not.toHaveBeenCalled();
    expect(createFlomoArchivePushBatchMock).not.toHaveBeenCalled();
    expect(sendMock).toHaveBeenCalledWith({
      content: "retry content",
      dedupeKey: "archive-articles-2026-03-01-fixed",
    });
  });

  it("returns sent=false when lock is not acquired", async () => {
    process.env.CRON_SECRET = "expected";
    tryAcquireFlomoArchivePushLockMock.mockResolvedValue(false);

    const response = await GET(
      new Request("https://example.com/api/v1/flomo/push-from-archive-articles?token=expected"),
    );
    const payload = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(payload.ok).toBe(true);
    expect(payload.sent).toBe(false);
    expect(payload.reason).toBe("Another flomo push is in progress");
    expect(listArchiveArticles).not.toHaveBeenCalled();
    expect(sendMock).not.toHaveBeenCalled();
    expect(releaseFlomoArchivePushLockMock).not.toHaveBeenCalled();
  });

  it("returns 500 when flomo send fails", async () => {
    process.env.CRON_SECRET = "expected";
    vi.mocked(listArchiveArticles).mockResolvedValue({
      totalArticles: 1,
      groups: [
        {
          date: "2026-03-01",
          items: [
            {
              article_id: "a1",
              title: "First",
              url: "https://example.com/a1",
              summary: "摘要",
              image_url: "",
              source_host: "example.com",
              date: "2026-03-01",
              digest_id: "d1",
              generated_at: "2026-03-01T00:00:00.000Z",
            },
          ],
        },
      ],
    });
    createFlomoArchivePushBatchMock.mockResolvedValue(undefined);
    sendMock.mockRejectedValueOnce(new Error("flomo unavailable"));

    const response = await GET(
      new Request("https://example.com/api/v1/flomo/push-from-archive-articles?token=expected&date=2026-03-01"),
    );
    const payload = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(500);
    expect(payload.ok).toBe(false);
    expect(payload.sent).toBe(false);
    expect(String(payload.error || "")).toContain("flomo unavailable");
    expect(markFlomoArchivePushBatchFailedMock).toHaveBeenCalledTimes(1);
  });
});
