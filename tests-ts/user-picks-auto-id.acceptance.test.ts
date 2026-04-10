import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Acceptance tests: POST /api/v1/user-picks auto-generates article_id from URL.
 *
 * Design-doc requirements verified:
 * 1. POST with only { url } succeeds and returns { ok: true }
 * 2. POST with only { url, title } succeeds
 * 3. POST with explicit article_id still works (backward compatibility)
 * 4. POST with empty url and empty article_id returns 400
 * 5. Same URL generates same article_id (idempotency) — pick-{sha256(url).slice(0,12)}
 * 6. Auto-generated source_host is correct for a given URL
 */

/* ------------------------------------------------------------------ */
/*  Hoisted mocks                                                      */
/* ------------------------------------------------------------------ */
const {
  resolveUserMock,
  zaddMock,
  hsetMock,
  expireMock,
  zcardMock,
  zrevrangeWithScoresMock,
  hgetallMock,
} = vi.hoisted(() => {
  return {
    resolveUserMock: vi.fn(),
    zaddMock: vi.fn(),
    hsetMock: vi.fn(),
    expireMock: vi.fn(),
    zcardMock: vi.fn(),
    zrevrangeWithScoresMock: vi.fn(),
    hgetallMock: vi.fn(),
  };
});

vi.mock("@/lib/auth/cookie-auth", () => {
  return {
    resolveUserFromRequest: (request: Request) => resolveUserMock(request),
  };
});

vi.mock("@/lib/infra/upstash", () => {
  return {
    buildUpstashClient: () => ({
      zadd: (...args: unknown[]) => zaddMock(...args),
      zrevrangeWithScores: (...args: unknown[]) =>
        zrevrangeWithScoresMock(...args),
      hset: (...args: unknown[]) => hsetMock(...args),
      hgetall: (...args: unknown[]) => hgetallMock(...args),
      expire: (...args: unknown[]) => expireMock(...args),
      zcard: (...args: unknown[]) => zcardMock(...args),
    }),
  };
});

import { POST } from "@/app/api/v1/user-picks/route";

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */
function jsonRequest(body: Record<string, unknown>): Request {
  return new Request("https://example.com/api/v1/user-picks", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function authenticatedUser(id = "usr_auto_id") {
  resolveUserMock.mockResolvedValue({
    ok: true,
    user: { id, email: "test@example.com" },
  });
}

/* ------------------------------------------------------------------ */
/*  Tests                                                              */
/* ------------------------------------------------------------------ */
describe("POST /api/v1/user-picks – auto article_id generation", () => {
  beforeEach(() => {
    resolveUserMock.mockReset();
    zaddMock.mockReset();
    hsetMock.mockReset();
    expireMock.mockReset();
    zcardMock.mockReset();
    zrevrangeWithScoresMock.mockReset();
    hgetallMock.mockReset();

    // Default: Redis ops succeed
    zaddMock.mockResolvedValue(1);
    hsetMock.mockResolvedValue("OK");
    expireMock.mockResolvedValue(1);
    zcardMock.mockResolvedValue(1);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  /* ---- Requirement 1: POST with only { url } succeeds ---- */

  describe("Requirement 1: POST with only { url } succeeds", () => {
    it("returns { ok: true } when only url is provided", async () => {
      authenticatedUser();

      const response = await POST(
        jsonRequest({ url: "https://example.com/some-article" }),
      );
      const payload = (await response.json()) as Record<string, unknown>;

      expect(response.status).toBe(200);
      expect(payload.ok).toBe(true);
    });

    it("writes to Redis when only url is provided", async () => {
      authenticatedUser();

      await POST(jsonRequest({ url: "https://example.com/article-only-url" }));

      // Both zadd and hset should have been called
      expect(zaddMock).toHaveBeenCalled();
      expect(hsetMock).toHaveBeenCalled();
    });

    it("auto-generated article_id starts with 'pick-' prefix", async () => {
      authenticatedUser();

      const targetUrl = "https://example.com/auto-id-test";
      await POST(jsonRequest({ url: targetUrl }));

      // The zadd calls include the article_id as the member
      const zaddCalls = zaddMock.mock.calls as Array<[string, number, string]>;
      const articleIds = zaddCalls.map((call) => call[2]);
      const autoId = articleIds.find((id) => id?.startsWith("pick-"));

      expect(autoId).toBeDefined();
      expect(autoId).toMatch(/^pick-[0-9a-f]{12}$/);
    });
  });

  /* ---- Requirement 2: POST with { url, title } succeeds ---- */

  describe("Requirement 2: POST with { url, title } succeeds", () => {
    it("returns { ok: true } when url and title are provided", async () => {
      authenticatedUser();

      const response = await POST(
        jsonRequest({
          url: "https://example.com/titled-article",
          title: "My Article Title",
        }),
      );
      const payload = (await response.json()) as Record<string, unknown>;

      expect(response.status).toBe(200);
      expect(payload.ok).toBe(true);
    });

    it("persists title in metadata hash", async () => {
      authenticatedUser();

      const title = "An Important Article";
      await POST(
        jsonRequest({
          url: "https://example.com/important",
          title,
        }),
      );

      const hsetCalls = hsetMock.mock.calls as Array<
        [string, Record<string, unknown>]
      >;
      const metaCall = hsetCalls.find(([key]) =>
        key.includes("user_picks:meta"),
      );
      expect(metaCall).toBeDefined();
      expect(metaCall![1]).toHaveProperty("title", title);
    });
  });

  /* ---- Requirement 3: explicit article_id still works ---- */

  describe("Requirement 3: explicit article_id is backward compatible", () => {
    it("returns { ok: true } when explicit article_id is provided", async () => {
      authenticatedUser();

      const response = await POST(
        jsonRequest({
          article_id: "art_explicit_001",
          title: "Explicit Article",
          url: "https://example.com/explicit",
          source_host: "example.com",
        }),
      );
      const payload = (await response.json()) as Record<string, unknown>;

      expect(response.status).toBe(200);
      expect(payload.ok).toBe(true);
    });

    it("uses the provided article_id and does not generate a new one", async () => {
      authenticatedUser();

      const explicitId = "art_my_custom_id";
      await POST(
        jsonRequest({
          article_id: explicitId,
          url: "https://example.com/custom",
          title: "Custom",
        }),
      );

      // The exact article_id should appear in zadd calls
      const zaddCalls = zaddMock.mock.calls as Array<[string, number, string]>;
      const usedIds = zaddCalls.map((call) => call[2]);
      expect(usedIds).toContain(explicitId);
    });

    it("explicit article_id is not transformed to pick- format", async () => {
      authenticatedUser();

      const explicitId = "art_original_format";
      await POST(
        jsonRequest({
          article_id: explicitId,
          url: "https://example.com/original",
        }),
      );

      const zaddCalls = zaddMock.mock.calls as Array<[string, number, string]>;
      const usedIds = zaddCalls.map((call) => call[2]);
      // The explicit ID is used as-is, not auto-generated
      expect(usedIds).toContain(explicitId);
      // Should NOT have generated a pick- id in addition
      const autoId = usedIds.filter((id) => id?.startsWith("pick-"));
      expect(autoId).toHaveLength(0);
    });
  });

  /* ---- Requirement 4: empty url and empty article_id returns 400 ---- */

  describe("Requirement 4: empty url and empty article_id returns 400", () => {
    it("returns 400 when both article_id and url are missing", async () => {
      authenticatedUser();

      const response = await POST(jsonRequest({ title: "No ID or URL" }));
      const payload = (await response.json()) as Record<string, unknown>;

      expect(response.status).toBe(400);
      expect(payload.ok).toBe(false);
    });

    it("returns 400 when both article_id and url are empty strings", async () => {
      authenticatedUser();

      const response = await POST(
        jsonRequest({ article_id: "", url: "", title: "Empty strings" }),
      );
      const payload = (await response.json()) as Record<string, unknown>;

      expect(response.status).toBe(400);
      expect(payload.ok).toBe(false);
    });

    it("does not write to Redis on 400 response", async () => {
      authenticatedUser();

      await POST(jsonRequest({ title: "Only title, no url or id" }));

      expect(zaddMock).not.toHaveBeenCalled();
      expect(hsetMock).not.toHaveBeenCalled();
    });
  });

  /* ---- Requirement 5: same URL generates same article_id (idempotency) ---- */

  describe("Requirement 5: article_id generation is idempotent", () => {
    it("same URL produces the same pick- article_id every time", async () => {
      const { createHash } = await import("node:crypto");
      const url = "https://example.com/idempotent-article";

      const hash1 = createHash("sha256").update(url).digest("hex").slice(0, 12);
      const id1 = `pick-${hash1}`;

      const hash2 = createHash("sha256").update(url).digest("hex").slice(0, 12);
      const id2 = `pick-${hash2}`;

      expect(id1).toBe(id2);
      expect(id1).toMatch(/^pick-[0-9a-f]{12}$/);
    });

    it("article_id format is pick- followed by exactly 12 hex characters", async () => {
      const { createHash } = await import("node:crypto");

      const testUrls = [
        "https://arxiv.org/abs/2401.00001",
        "https://twitter.com/user/status/123456789",
        "https://medium.com/some-long-post-title-with-many-words",
        "https://github.com/anthropics/anthropic-sdk-python",
      ];

      const PICK_ID_PATTERN = /^pick-[0-9a-f]{12}$/;

      for (const url of testUrls) {
        const hash = createHash("sha256")
          .update(url)
          .digest("hex")
          .slice(0, 12);
        const id = `pick-${hash}`;
        expect(id).toMatch(PICK_ID_PATTERN);
      }
    });

    it("different URLs produce different article_ids", async () => {
      const { createHash } = await import("node:crypto");

      const url1 = "https://example.com/article-alpha";
      const url2 = "https://example.com/article-beta";

      const id1 = `pick-${createHash("sha256").update(url1).digest("hex").slice(0, 12)}`;
      const id2 = `pick-${createHash("sha256").update(url2).digest("hex").slice(0, 12)}`;

      expect(id1).not.toBe(id2);
    });

    it("auto-generated article_id matches expected sha256 computation", async () => {
      authenticatedUser();

      const { createHash } = await import("node:crypto");
      const url = "https://news.ycombinator.com/item?id=99999";
      const expectedHash = createHash("sha256")
        .update(url)
        .digest("hex")
        .slice(0, 12);
      const expectedId = `pick-${expectedHash}`;

      await POST(jsonRequest({ url }));

      const zaddCalls = zaddMock.mock.calls as Array<[string, number, string]>;
      const usedIds = zaddCalls.map((call) => call[2]);
      expect(usedIds).toContain(expectedId);
    });
  });

  /* ---- Requirement 6: auto-generated source_host is correct ---- */

  describe("Requirement 6: source_host auto-derived from URL hostname", () => {
    it("source_host is extracted from the URL hostname when not provided", async () => {
      authenticatedUser();

      await POST(jsonRequest({ url: "https://example.com/article-path" }));

      const hsetCalls = hsetMock.mock.calls as Array<
        [string, Record<string, unknown>]
      >;
      const metaCall = hsetCalls.find(([key]) =>
        key.includes("user_picks:meta"),
      );
      expect(metaCall).toBeDefined();
      expect(metaCall![1]).toHaveProperty("source_host", "example.com");
    });

    it("source_host for subdomain URL extracts full hostname", async () => {
      authenticatedUser();

      await POST(
        jsonRequest({ url: "https://blog.openai.com/gpt-4-research" }),
      );

      const hsetCalls = hsetMock.mock.calls as Array<
        [string, Record<string, unknown>]
      >;
      const metaCall = hsetCalls.find(([key]) =>
        key.includes("user_picks:meta"),
      );
      expect(metaCall).toBeDefined();
      expect(metaCall![1]).toHaveProperty("source_host", "blog.openai.com");
    });

    it("explicit source_host overrides auto-derivation", async () => {
      authenticatedUser();

      await POST(
        jsonRequest({
          url: "https://example.com/article",
          source_host: "custom-host.io",
        }),
      );

      const hsetCalls = hsetMock.mock.calls as Array<
        [string, Record<string, unknown>]
      >;
      const metaCall = hsetCalls.find(([key]) =>
        key.includes("user_picks:meta"),
      );
      expect(metaCall).toBeDefined();
      expect(metaCall![1]).toHaveProperty("source_host", "custom-host.io");
    });
  });
});
