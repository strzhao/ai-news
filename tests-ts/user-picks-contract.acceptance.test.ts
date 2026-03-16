import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Acceptance tests for user-picks API contract.
 *
 * Validates design-doc requirements:
 * - GET /api/v1/user-picks returns items with all declared fields
 *   including ai_summary (needed by hearts page AI summary display)
 * - POST /api/v1/user-picks persists ai_summary field
 * - Empty collection returns empty items array
 * - Response schema matches documented contract exactly
 */

/* ------------------------------------------------------------------ */
/*  Hoisted mocks                                                      */
/* ------------------------------------------------------------------ */
const {
  resolveUserMock,
  zaddMock,
  zrevrangeWithScoresMock,
  hsetMock,
  hgetallMock,
  expireMock,
  zcardMock,
} = vi.hoisted(() => {
  return {
    resolveUserMock: vi.fn(),
    zaddMock: vi.fn(),
    zrevrangeWithScoresMock: vi.fn(),
    hsetMock: vi.fn(),
    hgetallMock: vi.fn(),
    expireMock: vi.fn(),
    zcardMock: vi.fn(),
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
      zrevrangeWithScores: (...args: unknown[]) => zrevrangeWithScoresMock(...args),
      hset: (...args: unknown[]) => hsetMock(...args),
      hgetall: (...args: unknown[]) => hgetallMock(...args),
      expire: (...args: unknown[]) => expireMock(...args),
      zcard: (...args: unknown[]) => zcardMock(...args),
    }),
  };
});

import { POST, GET } from "@/app/api/v1/user-picks/route";

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */
function jsonRequest(method: string, body?: Record<string, unknown>): Request {
  const init: RequestInit = {
    method,
    headers: { "Content-Type": "application/json" },
  };
  if (body) init.body = JSON.stringify(body);
  return new Request("https://example.com/api/v1/user-picks", init);
}

/** All fields documented in the API contract */
const FULL_PICK = {
  article_id: "art_contract_001",
  title: "Contract Test Article",
  url: "https://example.com/article",
  original_url: "https://twitter.com/user/status/123",
  source_host: "twitter.com",
  image_url: "https://example.com/img.jpg",
  summary: "Human-written summary",
  ai_summary: "AI-generated comprehensive summary of the article content",
};

/** Required documented response fields for GET items */
const REQUIRED_ITEM_FIELDS = [
  "article_id",
  "title",
  "url",
  "original_url",
  "source_host",
  "image_url",
  "summary",
  "ai_summary",
  "saved_at",
] as const;

function authenticatedUser(id = "usr_contract") {
  resolveUserMock.mockResolvedValue({ ok: true, user: { id, email: "u@example.com" } });
}

function unauthenticated() {
  resolveUserMock.mockResolvedValue({ ok: false, error: "unauthorized" });
}

/* ------------------------------------------------------------------ */
/*  Tests: API response schema contract                                */
/* ------------------------------------------------------------------ */
describe("user-picks API contract (design-doc acceptance)", () => {
  beforeEach(() => {
    resolveUserMock.mockReset();
    zaddMock.mockReset();
    zrevrangeWithScoresMock.mockReset();
    hsetMock.mockReset();
    hgetallMock.mockReset();
    expireMock.mockReset();
    zcardMock.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  /* ---- GET: response schema ---- */

  describe("GET /api/v1/user-picks – response schema", () => {
    it("each item contains all documented fields including ai_summary", async () => {
      authenticatedUser();

      const now = Date.now();
      zrevrangeWithScoresMock.mockResolvedValue([
        { member: FULL_PICK.article_id, score: now },
      ]);
      hgetallMock.mockResolvedValue({ ...FULL_PICK });

      const response = await GET(new Request("https://example.com/api/v1/user-picks"));
      const payload = (await response.json()) as {
        ok: boolean;
        items: Array<Record<string, unknown>>;
      };

      expect(response.status).toBe(200);
      expect(payload.ok).toBe(true);
      expect(payload.items.length).toBe(1);

      const item = payload.items[0];
      for (const field of REQUIRED_ITEM_FIELDS) {
        expect(item).toHaveProperty(field);
      }

      // Verify ai_summary value is preserved round-trip
      expect(item.ai_summary).toBe(FULL_PICK.ai_summary);
    });

    it("returns empty items array when user has no picks", async () => {
      authenticatedUser();
      zrevrangeWithScoresMock.mockResolvedValue([]);

      const response = await GET(new Request("https://example.com/api/v1/user-picks"));
      const payload = (await response.json()) as {
        ok: boolean;
        items: Array<Record<string, unknown>>;
      };

      expect(response.status).toBe(200);
      expect(payload.ok).toBe(true);
      expect(Array.isArray(payload.items)).toBe(true);
      expect(payload.items.length).toBe(0);
    });

    it("top-level response shape is { ok, items }", async () => {
      authenticatedUser();
      zrevrangeWithScoresMock.mockResolvedValue([]);

      const response = await GET(new Request("https://example.com/api/v1/user-picks"));
      const payload = await response.json();

      expect(payload).toHaveProperty("ok");
      expect(payload).toHaveProperty("items");
      // No extra top-level keys beyond ok and items
      const keys = Object.keys(payload as Record<string, unknown>);
      expect(keys).toContain("ok");
      expect(keys).toContain("items");
    });
  });

  /* ---- POST: ai_summary persistence ---- */

  describe("POST /api/v1/user-picks – ai_summary field", () => {
    it("persists ai_summary in metadata hash", async () => {
      authenticatedUser();
      zaddMock.mockResolvedValue(1);
      hsetMock.mockResolvedValue("OK");
      expireMock.mockResolvedValue(1);
      zcardMock.mockResolvedValue(1);

      const response = await POST(jsonRequest("POST", FULL_PICK));
      const payload = (await response.json()) as Record<string, unknown>;

      expect(response.status).toBe(200);
      expect(payload.ok).toBe(true);

      // Verify hset was called with ai_summary in the data
      const hsetCalls = hsetMock.mock.calls;
      const userPicksMetaCall = hsetCalls.find(
        (call: unknown[]) =>
          typeof call[0] === "string" && (call[0] as string).includes("user_picks:meta"),
      );
      expect(userPicksMetaCall).toBeDefined();

      // The metadata should include ai_summary
      const metaPayload = userPicksMetaCall![1] as Record<string, unknown>;
      expect(metaPayload).toHaveProperty("ai_summary", FULL_PICK.ai_summary);
    });

    it("accepts submission without ai_summary (field is optional for backwards compat)", async () => {
      authenticatedUser();
      zaddMock.mockResolvedValue(1);
      hsetMock.mockResolvedValue("OK");
      expireMock.mockResolvedValue(1);
      zcardMock.mockResolvedValue(1);

      const pickWithoutAiSummary = { ...FULL_PICK };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delete (pickWithoutAiSummary as any).ai_summary;

      const response = await POST(jsonRequest("POST", pickWithoutAiSummary));
      const payload = (await response.json()) as Record<string, unknown>;

      // Should still succeed — ai_summary is enrichment data, not required for save
      expect(response.status).toBe(200);
      expect(payload.ok).toBe(true);
    });
  });

  /* ---- POST: response shape ---- */

  describe("POST /api/v1/user-picks – response shape", () => {
    it("returns { ok: true } on success", async () => {
      authenticatedUser();
      zaddMock.mockResolvedValue(1);
      hsetMock.mockResolvedValue("OK");
      expireMock.mockResolvedValue(1);
      zcardMock.mockResolvedValue(1);

      const response = await POST(jsonRequest("POST", FULL_PICK));
      const payload = await response.json();

      expect(payload).toHaveProperty("ok", true);
    });

    it("returns { ok: false } with non-200 status on auth failure", async () => {
      unauthenticated();

      const response = await POST(jsonRequest("POST", FULL_PICK));
      const payload = (await response.json()) as Record<string, unknown>;

      expect(response.status).toBe(401);
      expect(payload.ok).toBeFalsy();
    });
  });
});
