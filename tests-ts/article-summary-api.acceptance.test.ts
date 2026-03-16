import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Acceptance tests for /api/article_summary/{article_id} route.
 *
 * Design-doc requirements verified:
 * 6. The drawer fetches markdown summary from /api/article_summary/{article_id}
 * 7. When markdown loads, it replaces the preloaded text
 * 8. If API fails but preloaded text exists, keep showing preloaded text
 * 9. If API fails and no preloaded text, show error
 *
 * These tests verify the API route handler contract: valid responses,
 * error handling, and response shape.
 */

/* ------------------------------------------------------------------ */
/*  Hoisted mocks                                                      */
/* ------------------------------------------------------------------ */
const { fetchArticleSummaryMock } = vi.hoisted(() => {
  return {
    fetchArticleSummaryMock: vi.fn(),
  };
});

vi.mock("@/lib/integrations/article-db-client", () => {
  return {
    fetchArticleSummary: (...args: unknown[]) =>
      fetchArticleSummaryMock(...args),
  };
});

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function buildRequest(articleId: string): Request {
  return new Request(
    `https://example.com/api/article_summary/${encodeURIComponent(articleId)}`,
    { method: "GET" },
  );
}

/**
 * Next.js 15 passes params as a Promise.
 */
function buildParams(articleId: string) {
  return { params: Promise.resolve({ article_id: articleId }) };
}

/* ------------------------------------------------------------------ */
/*  Tests                                                              */
/* ------------------------------------------------------------------ */
describe("article_summary API route (design-doc acceptance)", () => {
  beforeEach(() => {
    fetchArticleSummaryMock.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  /* ---- Success path ---- */

  describe("GET /api/article_summary/:article_id – success", () => {
    it("returns markdown summary for a valid article_id", async () => {
      const markdownContent = "# Summary\n\nThis is a **markdown** summary.";

      fetchArticleSummaryMock.mockResolvedValue({
        ai_summary: markdownContent,
        title: "Test Article",
        url: "https://example.com/article",
        original_url: "https://example.com/orig",
        source_host: "example.com",
        pub_date: "2026-03-15",
      });

      const { GET } = await import(
        "@/app/api/article_summary/[article_id]/route"
      );
      const response = await GET(
        buildRequest("art_123"),
        buildParams("art_123"),
      );
      const payload = await response.json();

      expect(response.status).toBe(200);
      // Response must include the markdown summary content
      expect(payload).toHaveProperty("ai_summary");
      expect(payload.ai_summary).toContain("markdown");
    });

    it("response includes article metadata (title, url)", async () => {
      fetchArticleSummaryMock.mockResolvedValue({
        ai_summary: "Some summary",
        title: "Article Title",
        url: "https://example.com/a",
        original_url: "https://example.com/orig",
        source_host: "example.com",
        pub_date: "2026-03-15",
      });

      const { GET } = await import(
        "@/app/api/article_summary/[article_id]/route"
      );
      const response = await GET(
        buildRequest("art_456"),
        buildParams("art_456"),
      );
      const payload = await response.json();

      expect(response.status).toBe(200);
      // The drawer needs title and meta info per design doc requirement 10
      expect(payload).toHaveProperty("title");
      expect(payload).toHaveProperty("url");
    });
  });

  /* ---- Missing article_id ---- */

  describe("GET /api/article_summary/:article_id – missing id", () => {
    it("returns 400 when article_id is empty", async () => {
      const { GET } = await import(
        "@/app/api/article_summary/[article_id]/route"
      );
      const response = await GET(
        buildRequest(""),
        buildParams(""),
      );

      expect(response.status).toBe(400);
      const payload = await response.json();
      expect(payload.ok).toBe(false);
    });
  });

  /* ---- Error handling ---- */

  describe("GET /api/article_summary/:article_id – error handling", () => {
    it("returns 500 when fetchArticleSummary throws", async () => {
      fetchArticleSummaryMock.mockRejectedValue(
        new Error("DB connection failed"),
      );

      const { GET } = await import(
        "@/app/api/article_summary/[article_id]/route"
      );
      const response = await GET(
        buildRequest("art_err"),
        buildParams("art_err"),
      );

      expect(response.status).toBe(500);
    });

    it("error response is structured JSON with ok: false", async () => {
      fetchArticleSummaryMock.mockRejectedValue(new Error("DB timeout"));

      const { GET } = await import(
        "@/app/api/article_summary/[article_id]/route"
      );
      const response = await GET(
        buildRequest("art_timeout"),
        buildParams("art_timeout"),
      );
      const payload = await response.json();

      expect(typeof payload).toBe("object");
      expect(payload.ok).toBe(false);
      expect(payload).toHaveProperty("error");
    });
  });
});
