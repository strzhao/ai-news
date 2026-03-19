/**
 * Acceptance tests for: AI Summary URL sharing
 *
 * Design goal: After clicking AI summary on the hearts (favorites) page,
 * the URL changes (for sharing), and anyone can open that URL to view the summary.
 *
 * These tests are BLACK-BOX — written solely from the design document.
 */

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/* ------------------------------------------------------------------ */
/*  1. File-existence checks — verifying the design's file footprint  */
/* ------------------------------------------------------------------ */

const root = path.resolve(__dirname, "..");

describe("file structure matches design doc", () => {
  it("hearts page exists (URL sync target)", () => {
    expect(fs.existsSync(path.join(root, "app/(main)/hearts/page.tsx"))).toBe(
      true,
    );
  });

  it("public summary page route exists at /summary/[article_id]", () => {
    expect(
      fs.existsSync(
        path.join(root, "app/(main)/summary/[article_id]/page.tsx"),
      ),
    ).toBe(true);
  });

  it("public article-meta API route exists", () => {
    expect(
      fs.existsSync(
        path.join(root, "app/api/v1/article-meta/[article_id]/route.ts"),
      ),
    ).toBe(true);
  });

  it("summary-drawer component exists", () => {
    expect(
      fs.existsSync(path.join(root, "app/components/summary-drawer.tsx")),
    ).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/*  2. Hearts page — URL synchronisation logic                        */
/* ------------------------------------------------------------------ */

describe("hearts page URL sync", () => {
  let heartsSource: string;

  it("hearts page source can be read", () => {
    heartsSource = fs.readFileSync(
      path.join(root, "app/(main)/hearts/page.tsx"),
      "utf-8",
    );
    expect(heartsSource.length).toBeGreaterThan(0);
  });

  it("references 'summary' search param for URL sync", () => {
    heartsSource ??= fs.readFileSync(
      path.join(root, "app/(main)/hearts/page.tsx"),
      "utf-8",
    );
    // The design says: pushState(?summary=articleId)
    expect(heartsSource).toMatch(/summary/);
  });

  it("uses pushState or replaceState for URL manipulation", () => {
    heartsSource ??= fs.readFileSync(
      path.join(root, "app/(main)/hearts/page.tsx"),
      "utf-8",
    );
    const hasPushState = /pushState/.test(heartsSource);
    const hasReplaceState = /replaceState/.test(heartsSource);
    const hasSearchParams = /searchParams|useSearchParams|URLSearchParams/.test(
      heartsSource,
    );
    expect(hasPushState || hasReplaceState || hasSearchParams).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/*  3. Public summary page — accessible without login                 */
/* ------------------------------------------------------------------ */

describe("public summary page /summary/[article_id]", () => {
  let summarySource: string;

  it("page source can be read", () => {
    summarySource = fs.readFileSync(
      path.join(root, "app/(main)/summary/[article_id]/page.tsx"),
      "utf-8",
    );
    expect(summarySource.length).toBeGreaterThan(0);
  });

  it("fetches article summary (calls article_summary API)", () => {
    summarySource ??= fs.readFileSync(
      path.join(root, "app/(main)/summary/[article_id]/page.tsx"),
      "utf-8",
    );
    // Must reference article_summary or article-meta API to load data
    const fetchesSummary =
      /article_summary|article-meta|articleSummary|articleMeta/.test(
        summarySource,
      );
    expect(fetchesSummary).toBe(true);
  });

  it("receives article_id from route params", () => {
    summarySource ??= fs.readFileSync(
      path.join(root, "app/(main)/summary/[article_id]/page.tsx"),
      "utf-8",
    );
    expect(summarySource).toMatch(/article_id|articleId/);
  });

  it("does NOT require authentication (no auth/login/session guard)", () => {
    summarySource ??= fs.readFileSync(
      path.join(root, "app/(main)/summary/[article_id]/page.tsx"),
      "utf-8",
    );
    // Should not contain auth-guard patterns that would block public access
    const hasAuthGuard =
      /requireAuth|useAuth\(\)|isAuthenticated|redirect.*login/.test(
        summarySource,
      );
    expect(hasAuthGuard).toBe(false);
  });

  it("renders article title somewhere in the page", () => {
    summarySource ??= fs.readFileSync(
      path.join(root, "app/(main)/summary/[article_id]/page.tsx"),
      "utf-8",
    );
    expect(summarySource).toMatch(/title/i);
  });
});

/* ------------------------------------------------------------------ */
/*  4. Article-meta public API — contract checks                      */
/* ------------------------------------------------------------------ */

describe("public article-meta API /api/v1/article-meta/[article_id]", () => {
  let apiSource: string;

  it("API route source can be read", () => {
    apiSource = fs.readFileSync(
      path.join(root, "app/api/v1/article-meta/[article_id]/route.ts"),
      "utf-8",
    );
    expect(apiSource.length).toBeGreaterThan(0);
  });

  it("exports a GET handler", () => {
    apiSource ??= fs.readFileSync(
      path.join(root, "app/api/v1/article-meta/[article_id]/route.ts"),
      "utf-8",
    );
    expect(apiSource).toMatch(
      /export\s+(async\s+)?function\s+GET|export\s+const\s+GET/,
    );
  });

  it("reads from hearts:meta or user_picks:meta Redis keys", () => {
    apiSource ??= fs.readFileSync(
      path.join(root, "app/api/v1/article-meta/[article_id]/route.ts"),
      "utf-8",
    );
    const readsRedis =
      /hearts:meta|user_picks:meta|hearts.*meta|user_picks.*meta/.test(
        apiSource,
      );
    expect(readsRedis).toBe(true);
  });

  it("returns JSON response", () => {
    apiSource ??= fs.readFileSync(
      path.join(root, "app/api/v1/article-meta/[article_id]/route.ts"),
      "utf-8",
    );
    expect(apiSource).toMatch(
      /NextResponse\.json|Response\.json|JSON\.stringify/,
    );
  });

  it("does NOT require authentication", () => {
    apiSource ??= fs.readFileSync(
      path.join(root, "app/api/v1/article-meta/[article_id]/route.ts"),
      "utf-8",
    );
    const hasAuthGuard =
      /requireAuth|resolveStatsAuth|verifyAccessToken|Bearer/.test(apiSource);
    expect(hasAuthGuard).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/*  5. Summary drawer — share button                                   */
/* ------------------------------------------------------------------ */

describe("summary-drawer share button", () => {
  let drawerSource: string;

  it("drawer source can be read", () => {
    drawerSource = fs.readFileSync(
      path.join(root, "app/components/summary-drawer.tsx"),
      "utf-8",
    );
    expect(drawerSource.length).toBeGreaterThan(0);
  });

  it("contains a share / copy-link mechanism", () => {
    drawerSource ??= fs.readFileSync(
      path.join(root, "app/components/summary-drawer.tsx"),
      "utf-8",
    );
    // Design says: "复制分享链接" button
    const hasShare =
      /share|clipboard|copyToClipboard|navigator\.clipboard|copy.*link|分享|复制/.test(
        drawerSource,
      );
    expect(hasShare).toBe(true);
  });

  it("builds a /summary/ URL for sharing", () => {
    drawerSource ??= fs.readFileSync(
      path.join(root, "app/components/summary-drawer.tsx"),
      "utf-8",
    );
    expect(drawerSource).toMatch(/\/summary\//);
  });
});
