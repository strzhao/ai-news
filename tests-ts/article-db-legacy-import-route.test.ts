import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/v1/migration/import-legacy/route";
import { runLegacyImport } from "@/lib/article-db/legacy-import";

vi.mock("@/lib/article-db/legacy-import", () => {
  return {
    runLegacyImport: vi.fn(),
  };
});

describe("article-db legacy import route", () => {
  afterEach(() => {
    vi.clearAllMocks();
    delete process.env.CRON_SECRET;
  });

  it("returns 401 when no valid auth token", async () => {
    process.env.CRON_SECRET = "secret";
    const response = await GET(new Request("https://example.com/api/v1/migration/import-legacy?days=30"));
    expect(response.status).toBe(401);
  });

  it("imports with query params when authorized", async () => {
    process.env.CRON_SECRET = "secret";

    vi.mocked(runLegacyImport).mockResolvedValue({
      ok: true,
      days: 30,
      limitPerDay: 10,
      articleLimitPerDay: 100,
      overwrite: true,
      qualityScore: 62,
      importedDates: 5,
      importedArticles: 50,
      importedSources: 12,
      message: "Legacy archive import completed.",
    });

    const response = await GET(
      new Request(
        "https://example.com/api/v1/migration/import-legacy?days=30&limit_per_day=20&article_limit_per_day=100&overwrite=1&quality_score=66",
        {
          headers: {
            Authorization: "Bearer secret",
          },
        },
      ),
    );

    const payload = (await response.json()) as Record<string, unknown>;
    expect(response.status).toBe(200);
    expect(payload.ok).toBe(true);
    expect(payload.imported_articles).toBe(50);
    expect(runLegacyImport).toHaveBeenCalledWith({
      days: 30,
      limitPerDay: 20,
      articleLimitPerDay: 100,
      overwrite: true,
      qualityScore: 66,
    });
  });
});
