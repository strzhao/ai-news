import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/v1/articles/high-quality/route";
import { listHighQualityByDate } from "@/lib/article-db/repository";

vi.mock("@/lib/article-db/repository", () => {
  return {
    listHighQualityByDate: vi.fn(),
  };
});

describe("article-db high-quality route", () => {
  afterEach(() => {
    vi.clearAllMocks();
    delete process.env.ARTICLE_DB_API_TOKEN;
  });

  it("returns 401 when api token is enabled but authorization header is missing", async () => {
    process.env.ARTICLE_DB_API_TOKEN = "secret-token";
    const response = await GET(new Request("https://example.com/api/v1/articles/high-quality?date=2026-03-01"));
    const payload = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(401);
    expect(payload.ok).toBe(false);
  });

  it("returns data when request is authorized", async () => {
    process.env.ARTICLE_DB_API_TOKEN = "secret-token";
    vi.mocked(listHighQualityByDate).mockResolvedValue({
      total: 1,
      items: [
        {
          article_id: "a1",
          title: "Title",
          url: "https://example.com/a1",
          summary: "summary",
          image_url: "",
          source_host: "example.com",
          source_id: "source_1",
          source_name: "Source",
          date: "2026-03-01",
          digest_id: "article_db_2026-03-01",
          generated_at: "2026-03-01T01:00:00.000Z",
          quality_score: 88,
          quality_tier: "high",
          confidence: 0.9,
          primary_type: "tooling",
          secondary_types: [],
          tag_groups: {
            topic: ["agent"],
          },
        },
      ],
    });

    const request = new Request("https://example.com/api/v1/articles/high-quality?date=2026-03-01&limit=20&offset=0", {
      headers: {
        Authorization: "Bearer secret-token",
      },
    });

    const response = await GET(request);
    const payload = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(payload.ok).toBe(true);
    expect(payload.total).toBe(1);
    expect(listHighQualityByDate).toHaveBeenCalledWith({
      date: "2026-03-01",
      limit: 20,
      offset: 0,
      tagGroup: undefined,
      tag: undefined,
      qualityTier: "high",
    });
  });

  it("supports quality_tier=general", async () => {
    process.env.ARTICLE_DB_API_TOKEN = "secret-token";
    vi.mocked(listHighQualityByDate).mockResolvedValue({
      total: 0,
      items: [],
    });

    const request = new Request("https://example.com/api/v1/articles/high-quality?date=2026-03-01&quality_tier=general", {
      headers: {
        Authorization: "Bearer secret-token",
      },
    });

    const response = await GET(request);
    const payload = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(payload.ok).toBe(true);
    expect(payload.quality_tier).toBe("general");
    expect(listHighQualityByDate).toHaveBeenCalledWith({
      date: "2026-03-01",
      limit: 50,
      offset: 0,
      tagGroup: undefined,
      tag: undefined,
      qualityTier: "general",
    });
  });
});
