import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Acceptance tests for article summary caching optimisation.
 *
 * Design-doc requirements verified:
 * 1. API route sets Cache-Control: public, s-maxage=300, stale-while-revalidate=3600
 *    when summary status is "completed" and summary_markdown is present.
 * 2. API route sets Cache-Control: no-store, max-age=0
 *    when summary status is NOT completed (generating / failed / no_content).
 * 3. Error responses (500) must NOT be cached.
 * 4. SummaryDrawer component must NOT use cache: "no-store" in its fetch calls.
 * 5. Summary standalone page must NOT use cache: "no-store" in its fetch calls.
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

function buildParams(articleId: string) {
  return { params: Promise.resolve({ article_id: articleId }) };
}

/* ------------------------------------------------------------------ */
/*  API Cache-Control tests                                            */
/* ------------------------------------------------------------------ */
describe("article_summary API cache headers (design-doc acceptance)", () => {
  beforeEach(() => {
    fetchArticleSummaryMock.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  /* ---- completed summary -> cacheable ---- */

  describe("completed summary with markdown -> cacheable response", () => {
    it("sets Cache-Control with s-maxage=300 and stale-while-revalidate=3600", async () => {
      fetchArticleSummaryMock.mockResolvedValue({
        ok: true,
        status: "completed",
        summary_markdown: "# Great Article\n\nSome summary content.",
        model_name: "gpt-4",
        updated_at: "2026-03-15T10:00:00Z",
      });

      const { GET } = await import(
        "@/app/api/article_summary/[article_id]/route"
      );
      const response = await GET(
        buildRequest("art_cached"),
        buildParams("art_cached"),
      );

      expect(response.status).toBe(200);

      const cacheControl = response.headers.get("Cache-Control");
      expect(cacheControl).toBeTruthy();
      expect(cacheControl).toContain("public");
      expect(cacheControl).toContain("s-maxage=300");
      expect(cacheControl).toContain("stale-while-revalidate=3600");
    });
  });

  /* ---- generating status -> not cacheable ---- */

  describe("generating status -> non-cacheable response", () => {
    it("sets Cache-Control: no-store, max-age=0", async () => {
      fetchArticleSummaryMock.mockResolvedValue({
        ok: true,
        status: "generating",
        summary_markdown: undefined,
      });

      const { GET } = await import(
        "@/app/api/article_summary/[article_id]/route"
      );
      const response = await GET(
        buildRequest("art_generating"),
        buildParams("art_generating"),
      );

      const cacheControl = response.headers.get("Cache-Control");
      expect(cacheControl).toBeTruthy();
      expect(cacheControl).toContain("no-store");
      expect(cacheControl).toContain("max-age=0");
      // Must NOT contain public or s-maxage
      expect(cacheControl).not.toContain("public");
      expect(cacheControl).not.toContain("s-maxage");
    });
  });

  /* ---- failed status -> not cacheable ---- */

  describe("failed status -> non-cacheable response", () => {
    it("sets Cache-Control: no-store, max-age=0", async () => {
      fetchArticleSummaryMock.mockResolvedValue({
        ok: true,
        status: "failed",
        error: "LLM timeout",
      });

      const { GET } = await import(
        "@/app/api/article_summary/[article_id]/route"
      );
      const response = await GET(
        buildRequest("art_failed"),
        buildParams("art_failed"),
      );

      const cacheControl = response.headers.get("Cache-Control");
      expect(cacheControl).toBeTruthy();
      expect(cacheControl).toContain("no-store");
      expect(cacheControl).toContain("max-age=0");
    });
  });

  /* ---- no_content status -> not cacheable ---- */

  describe("no_content status -> non-cacheable response", () => {
    it("sets Cache-Control: no-store, max-age=0", async () => {
      fetchArticleSummaryMock.mockResolvedValue({
        ok: true,
        status: "no_content",
      });

      const { GET } = await import(
        "@/app/api/article_summary/[article_id]/route"
      );
      const response = await GET(
        buildRequest("art_nocontent"),
        buildParams("art_nocontent"),
      );

      const cacheControl = response.headers.get("Cache-Control");
      expect(cacheControl).toBeTruthy();
      expect(cacheControl).toContain("no-store");
      expect(cacheControl).toContain("max-age=0");
    });
  });

  /* ---- completed but missing markdown -> not cacheable ---- */

  describe("completed status but NO summary_markdown -> non-cacheable", () => {
    it("sets Cache-Control: no-store, max-age=0 when markdown is absent", async () => {
      fetchArticleSummaryMock.mockResolvedValue({
        ok: true,
        status: "completed",
        summary_markdown: undefined,
      });

      const { GET } = await import(
        "@/app/api/article_summary/[article_id]/route"
      );
      const response = await GET(
        buildRequest("art_no_md"),
        buildParams("art_no_md"),
      );

      const cacheControl = response.headers.get("Cache-Control");
      expect(cacheControl).toBeTruthy();
      expect(cacheControl).toContain("no-store");
      expect(cacheControl).toContain("max-age=0");
    });
  });

  /* ---- error (throw) -> not cacheable ---- */

  describe("error response (500) -> non-cacheable", () => {
    it("does NOT set cacheable headers when fetchArticleSummary throws", async () => {
      fetchArticleSummaryMock.mockRejectedValue(
        new Error("DB connection failed"),
      );

      const { GET } = await import(
        "@/app/api/article_summary/[article_id]/route"
      );
      const response = await GET(
        buildRequest("art_error"),
        buildParams("art_error"),
      );

      expect(response.status).toBe(500);

      const cacheControl = response.headers.get("Cache-Control");
      // Either no cache header at all, or explicitly no-store
      if (cacheControl) {
        expect(cacheControl).toContain("no-store");
        expect(cacheControl).not.toContain("s-maxage");
      }
    });
  });
});

/* ------------------------------------------------------------------ */
/*  Frontend source-code scan: no "no-store" in fetch calls            */
/* ------------------------------------------------------------------ */
describe("frontend fetch calls must NOT use cache: 'no-store' (source scan)", () => {
  const projectRoot = path.resolve(__dirname, "../../../..");

  it("SummaryDrawer does not contain cache: 'no-store' in fetch calls", () => {
    const filePath = path.join(
      projectRoot,
      "app/components/summary-drawer.tsx",
    );
    const source = fs.readFileSync(filePath, "utf-8");

    // The design requires removing cache: "no-store" from fetch calls
    // We check that no fetch call includes no-store
    const noStorePattern =
      /fetch\s*\([^)]*\{[^}]*cache\s*:\s*["']no-store["']/s;
    expect(source).not.toMatch(noStorePattern);

    // Also check the simpler pattern for inline options
    expect(source).not.toMatch(/["']no-store["']/);
  });

  it("summary standalone page does not contain cache: 'no-store' in fetch calls", () => {
    const filePath = path.join(
      projectRoot,
      "app/(main)/summary/[article_id]/page.tsx",
    );
    const source = fs.readFileSync(filePath, "utf-8");

    const noStorePattern =
      /fetch\s*\([^)]*\{[^}]*cache\s*:\s*["']no-store["']/s;
    expect(source).not.toMatch(noStorePattern);

    expect(source).not.toMatch(/["']no-store["']/);
  });
});
