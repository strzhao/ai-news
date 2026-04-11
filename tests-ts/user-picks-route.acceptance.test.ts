import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
      zrevrangeWithScores: (...args: unknown[]) =>
        zrevrangeWithScoresMock(...args),
      hset: (...args: unknown[]) => hsetMock(...args),
      hgetall: (...args: unknown[]) => hgetallMock(...args),
      expire: (...args: unknown[]) => expireMock(...args),
      zcard: (...args: unknown[]) => zcardMock(...args),
    }),
  };
});

import { GET, POST } from "@/app/api/v1/user-picks/route";

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

const SAMPLE_PICK = {
  article_id: "art_001",
  title: "Test Article",
  url: "https://example.com/article",
  original_url: "https://example.com/original",
  source_host: "example.com",
  image_url: "https://example.com/img.jpg",
  summary: "A short summary",
  ai_summary: "AI generated summary",
};

/* ------------------------------------------------------------------ */
/*  Tests                                                              */
/* ------------------------------------------------------------------ */
describe("POST /api/v1/user-picks", () => {
  beforeEach(() => {
    resolveUserMock.mockReset();
    zaddMock.mockReset();
    hsetMock.mockReset();
    expireMock.mockReset();
    zcardMock.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 when not authenticated", async () => {
    resolveUserMock.mockResolvedValue({ ok: false, error: "unauthorized" });

    const response = await POST(jsonRequest("POST", SAMPLE_PICK));
    const payload = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(401);
    expect(payload.ok).toBeFalsy();
    // Redis should not be touched
    expect(zaddMock).not.toHaveBeenCalled();
    expect(hsetMock).not.toHaveBeenCalled();
  });

  it("returns 400 when both article_id and url are missing", async () => {
    resolveUserMock.mockResolvedValue({
      ok: true,
      user: { id: "usr_123", email: "u@example.com" },
    });

    const body = { ...SAMPLE_PICK };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (body as any).article_id;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (body as any).url;

    const response = await POST(jsonRequest("POST", body));
    const payload = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(400);
    expect(payload.ok).toBeFalsy();
    expect(zaddMock).not.toHaveBeenCalled();
  });

  it("auto-generates article_id from url when article_id is missing", async () => {
    resolveUserMock.mockResolvedValue({
      ok: true,
      user: { id: "usr_123", email: "u@example.com" },
    });
    zaddMock.mockResolvedValue(1);
    hsetMock.mockResolvedValue("OK");
    expireMock.mockResolvedValue(1);
    zcardMock.mockResolvedValue(1);

    const body = { ...SAMPLE_PICK };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (body as any).article_id;

    const response = await POST(jsonRequest("POST", body));
    const payload = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(payload.ok).toBe(true);
    expect(zaddMock).toHaveBeenCalled();
  });

  it("saves pick and auto-hearts on valid submission", async () => {
    const userId = "usr_123";
    resolveUserMock.mockResolvedValue({
      ok: true,
      user: { id: userId, email: "u@example.com" },
    });
    zaddMock.mockResolvedValue(1);
    hsetMock.mockResolvedValue("OK");
    expireMock.mockResolvedValue(1);
    zcardMock.mockResolvedValue(1);

    const response = await POST(jsonRequest("POST", SAMPLE_PICK));
    const payload = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(payload.ok).toBe(true);

    // Verify user_picks sorted set write
    const zaddCalls = zaddMock.mock.calls;
    const userPicksZadd = zaddCalls.find(
      (call: unknown[]) =>
        typeof call[0] === "string" &&
        (call[0] as string).includes("user_picks"),
    );
    expect(userPicksZadd).toBeDefined();

    // Verify hearts sorted set write (auto-heart)
    const heartsZadd = zaddCalls.find(
      (call: unknown[]) =>
        typeof call[0] === "string" && (call[0] as string).includes("hearts"),
    );
    expect(heartsZadd).toBeDefined();

    // Verify metadata hashes written
    const hsetCalls = hsetMock.mock.calls;
    const userPicksMeta = hsetCalls.find(
      (call: unknown[]) =>
        typeof call[0] === "string" &&
        (call[0] as string).includes("user_picks:meta"),
    );
    expect(userPicksMeta).toBeDefined();

    const heartsMeta = hsetCalls.find(
      (call: unknown[]) =>
        typeof call[0] === "string" &&
        (call[0] as string).includes("hearts:meta"),
    );
    expect(heartsMeta).toBeDefined();
  });
});

describe("GET /api/v1/user-picks", () => {
  beforeEach(() => {
    resolveUserMock.mockReset();
    zrevrangeWithScoresMock.mockReset();
    hgetallMock.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 when not authenticated", async () => {
    resolveUserMock.mockResolvedValue({ ok: false, error: "unauthorized" });

    const response = await GET(
      new Request("https://example.com/api/v1/user-picks"),
    );
    const payload = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(401);
    expect(payload.ok).toBeFalsy();
    expect(zrevrangeWithScoresMock).not.toHaveBeenCalled();
  });

  it("returns items list in reverse chronological order", async () => {
    const userId = "usr_123";
    resolveUserMock.mockResolvedValue({
      ok: true,
      user: { id: userId, email: "u@example.com" },
    });

    const now = Date.now();
    zrevrangeWithScoresMock.mockResolvedValue([
      { member: "art_002", score: now },
      { member: "art_001", score: now - 1000 },
    ]);

    hgetallMock.mockImplementation((key: string) => {
      if (key.includes("art_002")) {
        return Promise.resolve({
          article_id: "art_002",
          title: "Second Article",
          url: "https://example.com/2",
          original_url: "https://example.com/2",
          source_host: "example.com",
          image_url: "",
          summary: "summary 2",
          ai_summary: "ai 2",
        });
      }
      return Promise.resolve({
        article_id: "art_001",
        title: "First Article",
        url: "https://example.com/1",
        original_url: "https://example.com/1",
        source_host: "example.com",
        image_url: "",
        summary: "summary 1",
        ai_summary: "ai 1",
      });
    });

    const response = await GET(
      new Request("https://example.com/api/v1/user-picks"),
    );
    const payload = (await response.json()) as {
      ok: boolean;
      items: Array<Record<string, unknown>>;
    };

    expect(response.status).toBe(200);
    expect(payload.ok).toBe(true);
    expect(Array.isArray(payload.items)).toBe(true);
    expect(payload.items.length).toBe(2);

    // First item should be the more recent one (art_002)
    expect(payload.items[0].article_id).toBe("art_002");
    expect(payload.items[1].article_id).toBe("art_001");

    // Each item should have saved_at
    for (const item of payload.items) {
      expect(item).toHaveProperty("saved_at");
    }
  });
});
