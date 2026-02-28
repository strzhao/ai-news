import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/archive_articles/route";
import { listArchiveArticles } from "@/lib/domain/archive-articles";

vi.mock("@/lib/domain/archive-articles", () => {
  return {
    listArchiveArticles: vi.fn(),
  };
});

describe("archive_articles route", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("returns article groups", async () => {
    vi.mocked(listArchiveArticles).mockResolvedValue({
      totalArticles: 1,
      groups: [
        {
          date: "2026-02-28",
          items: [
            {
              article_id: "id_1",
              title: "Article",
              url: "https://example.com/a",
              summary: "summary",
              image_url: "",
              source_host: "example.com",
              date: "2026-02-28",
              digest_id: "digest_1",
              generated_at: "2026-02-28T10:00:00.000Z",
            },
          ],
        },
      ],
    });

    const request = new Request(
      "https://example.com/api/archive_articles?days=7&limit_per_day=12&article_limit_per_day=30&image_probe_limit=5",
    );
    const response = await GET(request);
    const payload = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(payload.ok).toBe(true);
    expect(payload.total_articles).toBe(1);
    expect(Array.isArray(payload.groups)).toBe(true);
    expect(listArchiveArticles).toHaveBeenCalledWith({
      days: 7,
      limitPerDay: 12,
      articleLimitPerDay: 30,
      imageProbeLimit: 5,
    });
  });

  it("supports article_limit_per_day=0 as unlimited mode", async () => {
    vi.mocked(listArchiveArticles).mockResolvedValue({
      totalArticles: 0,
      groups: [],
    });

    const request = new Request("https://example.com/api/archive_articles?article_limit_per_day=0");
    const response = await GET(request);
    const payload = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(payload.ok).toBe(true);
    expect(listArchiveArticles).toHaveBeenCalledWith({
      days: 30,
      limitPerDay: 10,
      articleLimitPerDay: 0,
      imageProbeLimit: 24,
    });
  });

  it("returns 500 when listArchiveArticles throws", async () => {
    vi.mocked(listArchiveArticles).mockRejectedValue(new Error("unexpected"));

    const request = new Request("https://example.com/api/archive_articles");
    const response = await GET(request);
    const payload = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(500);
    expect(payload.ok).toBe(false);
    expect(String(payload.error || "")).toContain("unexpected");
  });
});
