import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { verifyAccessTokenMock } = vi.hoisted(() => {
  return {
    verifyAccessTokenMock: vi.fn(),
  };
});

vi.mock("@stringzhao/auth-sdk", () => {
  return {
    createRemoteJwksVerifier: () => {
      return {
        verifyAccessToken: (token: string) => verifyAccessTokenMock(token),
      };
    },
  };
});

import { extractBearerToken, resolveStatsAuth } from "@/lib/auth/unified-auth";

describe("unified auth", () => {
  beforeEach(() => {
    verifyAccessTokenMock.mockReset();
    delete process.env.TRACKER_API_TOKEN;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("parses bearer token", () => {
    expect(extractBearerToken("Bearer abc")).toBe("abc");
    expect(extractBearerToken("bearer abc")).toBe("abc");
    expect(extractBearerToken("Token abc")).toBe("");
    expect(extractBearerToken("")).toBe("");
  });

  it("returns missing_access_token without authorization header", async () => {
    const request = new Request("https://example.com/api/stats/sources");
    const result = await resolveStatsAuth(request);

    expect(result).toEqual({ ok: false, error: "missing_access_token" });
    expect(verifyAccessTokenMock).not.toHaveBeenCalled();
  });

  it("accepts unified jwt token", async () => {
    verifyAccessTokenMock.mockResolvedValue({
      sub: "usr_1",
      email: "user@example.com",
      displayName: null,
      avatarUrl: null,
      status: "ACTIVE",
    });

    const request = new Request("https://example.com/api/stats/sources", {
      headers: { Authorization: "Bearer jwt-token" },
    });
    const result = await resolveStatsAuth(request);

    expect(result).toEqual({
      ok: true,
      mode: "unified_jwt",
      user: {
        sub: "usr_1",
        email: "user@example.com",
        displayName: null,
        avatarUrl: null,
        status: "ACTIVE",
      },
    });
  });

  it("falls back to tracker token when jwt verification fails", async () => {
    process.env.TRACKER_API_TOKEN = "tracker-token";
    verifyAccessTokenMock.mockRejectedValue(new Error("invalid token"));

    const request = new Request("https://example.com/api/stats/sources", {
      headers: { Authorization: "Bearer tracker-token" },
    });
    const result = await resolveStatsAuth(request);

    expect(result).toEqual({
      ok: true,
      mode: "tracker_token",
      user: null,
    });
  });

  it("returns invalid_access_token when both auth checks fail", async () => {
    process.env.TRACKER_API_TOKEN = "tracker-token";
    verifyAccessTokenMock.mockRejectedValue(new Error("invalid token"));

    const request = new Request("https://example.com/api/stats/sources", {
      headers: { Authorization: "Bearer bad-token" },
    });
    const result = await resolveStatsAuth(request);

    expect(result).toEqual({ ok: false, error: "invalid_access_token" });
  });
});
