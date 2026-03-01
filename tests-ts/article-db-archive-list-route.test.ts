import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/v1/articles/archive-list/route";
import { listArchivedArticles } from "@/lib/article-db/repository";

vi.mock("@/lib/article-db/repository", () => {
  return {
    listArchivedArticles: vi.fn(),
  };
});

describe("article-db archive-list route", () => {
  afterEach(() => {
    vi.clearAllMocks();
    delete process.env.ARTICLE_DB_API_TOKEN;
  });

  it("returns 401 when token is required but missing", async () => {
    process.env.ARTICLE_DB_API_TOKEN = "secret-token";
    const response = await GET(new Request("https://example.com/api/v1/articles/archive-list"));
    const payload = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(401);
    expect(payload.ok).toBe(false);
  });

  it("returns filtered archive rows when request is authorized", async () => {
    process.env.ARTICLE_DB_API_TOKEN = "secret-token";
    vi.mocked(listArchivedArticles).mockResolvedValue({
      total: 1,
      items: [
        {
          article_id: "a1",
          date: "2026-03-01",
          analyzed_at: "2026-03-01T01:00:00.000Z",
          selected_at: "2026-03-01T01:02:00.000Z",
          is_selected: true,
          source_id: "s1",
          source_name: "Source",
          source_host: "example.com",
          title: "Title",
          canonical_url: "https://example.com/a1",
          original_url: "https://example.com/a1",
          info_url: "https://example.com/a1",
          published_at: "2026-03-01T00:00:00.000Z",
          summary_raw: "",
          lead_paragraph: "",
          quality_score_snapshot: 88,
          rank_score: 999000,
          quality_score: 86,
          confidence: 0.91,
          worth: "必读",
          one_line_summary: "summary",
          reason_short: "reason",
          action_hint: "action",
          company_impact: 4,
          team_impact: 4,
          personal_impact: 4,
          execution_clarity: 4,
          novelty_score: 4,
          clarity_score: 4,
          best_for_roles: [],
          evidence_signals: [],
          primary_type: "tooling",
          secondary_types: [],
          tag_groups: {},
          quality_tier: "high",
          feedback_good_count: 0,
          feedback_bad_count: 0,
          feedback_total_count: 0,
          feedback_last: "",
          feedback_last_at: "",
        },
      ],
    });

    const request = new Request(
      "https://example.com/api/v1/articles/archive-list?from=2026-02-01&to=2026-03-01&quality_tier=all&limit=50&offset=10&source_id=s1&primary_type=tooling&q=agent",
      {
        headers: {
          Authorization: "Bearer secret-token",
        },
      },
    );
    const response = await GET(request);
    const payload = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(payload.ok).toBe(true);
    expect(payload.total).toBe(1);
    expect(listArchivedArticles).toHaveBeenCalledWith({
      fromDate: "2026-02-01",
      toDate: "2026-03-01",
      qualityTier: "all",
      limit: 50,
      offset: 10,
      sourceId: "s1",
      primaryType: "tooling",
      search: "agent",
    });
  });
});
