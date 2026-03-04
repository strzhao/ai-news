import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  resolveStatsAuthMock,
  pipelineMock,
} = vi.hoisted(() => {
  return {
    resolveStatsAuthMock: vi.fn(),
    pipelineMock: vi.fn(),
  };
});

vi.mock("@/lib/auth/unified-auth", () => {
  return {
    resolveStatsAuth: (request: Request) => resolveStatsAuthMock(request),
  };
});

vi.mock("@/lib/domain/tracker-common", () => {
  return {
    buildUpstashClient: () => {
      return {
        pipeline: (commands: Array<Array<string | number>>) => pipelineMock(commands),
      };
    },
    lastNDateKeys: (days: number) => {
      const all = ["20260303", "20260302", "20260301"];
      return all.slice(0, Math.max(1, Math.min(days, all.length)));
    },
    keyToIsoDate: (dateKey: string) => `${dateKey.slice(0, 4)}-${dateKey.slice(4, 6)}-${dateKey.slice(6, 8)}`,
    parseHashResult: (payload: unknown) => (payload && typeof payload === "object" ? (payload as Record<string, number>) : {}),
  };
});

import { GET } from "@/app/api/stats/sources/route";

describe("stats sources route", () => {
  beforeEach(() => {
    resolveStatsAuthMock.mockReset();
    pipelineMock.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 when auth fails", async () => {
    resolveStatsAuthMock.mockResolvedValue({ ok: false, error: "missing_access_token" });

    const response = await GET(new Request("https://example.com/api/stats/sources"));
    const payload = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(401);
    expect(payload).toMatchObject({ ok: false, error: "missing_access_token" });
    expect(pipelineMock).not.toHaveBeenCalled();
  });

  it("returns rows when tracker token mode is accepted", async () => {
    resolveStatsAuthMock.mockResolvedValue({ ok: true, mode: "tracker_token", user: null });
    pipelineMock.mockResolvedValue([
      { result: { openai: 9, anthropic: 1 } },
      { result: { openai: 4 } },
    ]);

    const response = await GET(new Request("https://example.com/api/stats/sources?days=2"));
    const payload = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(payload.days).toBe(2);
    expect(payload.rows).toEqual([
      { date: "2026-03-02", source_id: "openai", clicks: 4 },
      { date: "2026-03-03", source_id: "anthropic", clicks: 1 },
      { date: "2026-03-03", source_id: "openai", clicks: 9 },
    ]);
  });

  it("returns rows when unified jwt mode is accepted", async () => {
    resolveStatsAuthMock.mockResolvedValue({
      ok: true,
      mode: "unified_jwt",
      user: {
        sub: "usr_xxx",
        email: "user@example.com",
      },
    });
    pipelineMock.mockResolvedValue([{ result: { openai: 3 } }]);

    const response = await GET(new Request("https://example.com/api/stats/sources?days=1"));
    const payload = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(payload.days).toBe(1);
    expect(payload.rows).toEqual([{ date: "2026-03-03", source_id: "openai", clicks: 3 }]);
  });

  it("returns 500 when upstash query fails", async () => {
    resolveStatsAuthMock.mockResolvedValue({ ok: true, mode: "tracker_token", user: null });
    pipelineMock.mockRejectedValue(new Error("upstash down"));

    const response = await GET(new Request("https://example.com/api/stats/sources?days=2"));
    const payload = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(500);
    expect(String(payload.error || "")).toContain("upstash down");
  });
});
