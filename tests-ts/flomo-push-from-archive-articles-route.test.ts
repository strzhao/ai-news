import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/v1/flomo/push-from-archive-articles/route";
import { listArchiveArticles } from "@/lib/domain/archive-articles";

const { sendMock } = vi.hoisted(() => {
  return {
    sendMock: vi.fn(),
  };
});

vi.mock("@/lib/domain/archive-articles", () => {
  return {
    listArchiveArticles: vi.fn(),
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

  it("returns sent=false when no article is available", async () => {
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
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("sends flomo payload based on archive_articles data", async () => {
    process.env.CRON_SECRET = "expected";
    process.env.FLOMO_H5_URL = "https://ai-news.example.com";
    process.env.TRACKER_BASE_URL = "https://tracker.example.com";
    process.env.TRACKER_SIGNING_SECRET = "tracker-secret";
    vi.mocked(listArchiveArticles).mockResolvedValue({
      totalArticles: 2,
      groups: [
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
            {
              article_id: "a2",
              title: "Second title",
              url: "https://example.com/a2",
              summary: "第二篇摘要",
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

    const response = await GET(
      new Request("https://example.com/api/v1/flomo/push-from-archive-articles?token=expected&date=2026-03-01"),
    );
    const payload = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(payload.ok).toBe(true);
    expect(payload.sent).toBe(true);
    expect(payload.article_count).toBe(2);
    expect(listArchiveArticles).toHaveBeenCalledWith({
      days: 1,
      limitPerDay: 30,
      articleLimitPerDay: 30,
      imageProbeLimit: 0,
      qualityTier: "high",
    });
    expect(sendMock).toHaveBeenCalledTimes(1);

    const sentPayload = sendMock.mock.calls[0]?.[0] as { content: string; dedupeKey: string };
    expect(sentPayload.dedupeKey).toBe("archive-articles-2026-03-01");
    expect(sentPayload.content).toContain("【重点文章】");
    expect(sentPayload.content).toContain("1. First title");
    expect(sentPayload.content).toContain("2. Second title");
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
    sendMock.mockRejectedValueOnce(new Error("flomo unavailable"));

    const response = await GET(
      new Request("https://example.com/api/v1/flomo/push-from-archive-articles?token=expected&date=2026-03-01"),
    );
    const payload = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(500);
    expect(payload.ok).toBe(false);
    expect(payload.sent).toBe(false);
    expect(String(payload.error || "")).toContain("flomo unavailable");
  });
});
