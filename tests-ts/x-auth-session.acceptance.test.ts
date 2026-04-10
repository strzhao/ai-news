import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Acceptance tests: X-Auth-Session header authentication.
 *
 * Design-doc requirements verified:
 * 1. Request with valid X-Auth-Session header (HMAC-signed session value) is authenticated
 * 2. Request with invalid X-Auth-Session header is rejected (401)
 * 3. Cookie auth still works (backward compatibility)
 * 4. Cookie takes precedence over X-Auth-Session header when both present
 *
 * These tests call readGatewaySessionFromRequest directly (existing code),
 * and also verify the behavior via the user-picks route as an integration probe.
 */

/* ------------------------------------------------------------------ */
/*  Hoisted mocks for route integration tests                         */
/* ------------------------------------------------------------------ */
const {
  zaddMock,
  hsetMock,
  expireMock,
  zcardMock,
  zrevrangeWithScoresMock,
  hgetallMock,
} = vi.hoisted(() => {
  return {
    zaddMock: vi.fn(),
    hsetMock: vi.fn(),
    expireMock: vi.fn(),
    zcardMock: vi.fn(),
    zrevrangeWithScoresMock: vi.fn(),
    hgetallMock: vi.fn(),
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
import {
  createGatewaySessionCookieValue,
  GATEWAY_SESSION_COOKIE_NAME,
  readGatewaySessionFromRequest,
} from "@/lib/auth/gateway-session";

/* ------------------------------------------------------------------ */
/*  Test session fixtures                                              */
/* ------------------------------------------------------------------ */

const TEST_USER_ID = "usr_header_test";
const TEST_EMAIL = "header-test@example.com";

/**
 * Create a valid signed session value — same logic as createGatewaySessionCookieValue.
 * This is the value that would be placed in either cookie or X-Auth-Session header.
 */
function makeValidSessionValue(
  userId = TEST_USER_ID,
  email = TEST_EMAIL,
): string {
  return createGatewaySessionCookieValue(userId, email);
}

/**
 * Build a request with only the X-Auth-Session header (no cookie).
 */
function requestWithHeaderOnly(
  sessionValue: string,
  body?: Record<string, unknown>,
): Request {
  const init: RequestInit = {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Auth-Session": sessionValue,
    },
    body: body
      ? JSON.stringify(body)
      : JSON.stringify({ url: "https://example.com/test" }),
  };
  return new Request("https://example.com/api/v1/user-picks", init);
}

/**
 * Build a request with only the session cookie (no header).
 */
function requestWithCookieOnly(
  sessionValue: string,
  body?: Record<string, unknown>,
): Request {
  const cookieHeader = `${GATEWAY_SESSION_COOKIE_NAME}=${encodeURIComponent(sessionValue)}`;
  const init: RequestInit = {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: cookieHeader,
    },
    body: body
      ? JSON.stringify(body)
      : JSON.stringify({ url: "https://example.com/test" }),
  };
  return new Request("https://example.com/api/v1/user-picks", init);
}

/**
 * Build a request with both cookie and X-Auth-Session header.
 */
function requestWithBoth(
  cookieSessionValue: string,
  headerSessionValue: string,
  body?: Record<string, unknown>,
): Request {
  const cookieHeader = `${GATEWAY_SESSION_COOKIE_NAME}=${encodeURIComponent(cookieSessionValue)}`;
  const init: RequestInit = {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: cookieHeader,
      "X-Auth-Session": headerSessionValue,
    },
    body: body
      ? JSON.stringify(body)
      : JSON.stringify({ url: "https://example.com/test" }),
  };
  return new Request("https://example.com/api/v1/user-picks", init);
}

/* ------------------------------------------------------------------ */
/*  Unit tests for readGatewaySessionFromRequest                       */
/* ------------------------------------------------------------------ */

describe("readGatewaySessionFromRequest – X-Auth-Session header", () => {
  /* ---- Requirement 1: valid header is authenticated ---- */

  describe("Requirement 1: valid X-Auth-Session header is accepted", () => {
    it("returns session payload when X-Auth-Session header has valid signed value", () => {
      const sessionValue = makeValidSessionValue();
      const request = new Request("https://example.com/api/test", {
        headers: { "X-Auth-Session": sessionValue },
      });

      const session = readGatewaySessionFromRequest(request);

      expect(session).not.toBeNull();
      expect(session?.userId).toBe(TEST_USER_ID);
      expect(session?.email).toBe(TEST_EMAIL.toLowerCase());
    });

    it("session payload has correct userId from X-Auth-Session header", () => {
      const userId = "usr_custom_abc";
      const sessionValue = createGatewaySessionCookieValue(
        userId,
        "custom@example.com",
      );
      const request = new Request("https://example.com/api/test", {
        headers: { "X-Auth-Session": sessionValue },
      });

      const session = readGatewaySessionFromRequest(request);

      expect(session?.userId).toBe(userId);
    });

    it("session payload has correct email from X-Auth-Session header", () => {
      const email = "specific-user@example.com";
      const sessionValue = createGatewaySessionCookieValue("usr_abc", email);
      const request = new Request("https://example.com/api/test", {
        headers: { "X-Auth-Session": sessionValue },
      });

      const session = readGatewaySessionFromRequest(request);

      expect(session?.email).toBe(email.toLowerCase());
    });

    it("session payload contains valid issuedAt and expiresAt timestamps", () => {
      const sessionValue = makeValidSessionValue();
      const request = new Request("https://example.com/api/test", {
        headers: { "X-Auth-Session": sessionValue },
      });

      const session = readGatewaySessionFromRequest(request);

      expect(session).not.toBeNull();
      expect(session?.issuedAt).toBeGreaterThan(0);
      expect(session?.expiresAt).toBeGreaterThan(Date.now());
    });
  });

  /* ---- Requirement 2: invalid header is rejected ---- */

  describe("Requirement 2: invalid X-Auth-Session header is rejected", () => {
    it("returns null when X-Auth-Session header has tampered signature", () => {
      const sessionValue = makeValidSessionValue();
      // Tamper: replace the signature part with garbage
      const [encoded] = sessionValue.split(".");
      const tampered = `${encoded}.invalidsignature`;

      const request = new Request("https://example.com/api/test", {
        headers: { "X-Auth-Session": tampered },
      });

      const session = readGatewaySessionFromRequest(request);
      expect(session).toBeNull();
    });

    it("returns null when X-Auth-Session header contains a random string", () => {
      const request = new Request("https://example.com/api/test", {
        headers: { "X-Auth-Session": "this-is-not-a-valid-session" },
      });

      const session = readGatewaySessionFromRequest(request);
      expect(session).toBeNull();
    });

    it("returns null when X-Auth-Session header is an empty string", () => {
      const request = new Request("https://example.com/api/test", {
        headers: { "X-Auth-Session": "" },
      });

      const session = readGatewaySessionFromRequest(request);
      expect(session).toBeNull();
    });

    it("returns null when X-Auth-Session header has valid format but wrong HMAC secret", () => {
      // Build a session signed with a different secret by manipulating env
      const originalSecret = process.env.AUTH_GATEWAY_SESSION_SECRET;
      process.env.AUTH_GATEWAY_SESSION_SECRET = "different-secret-for-signing";
      const sessionSignedWithWrongSecret = makeValidSessionValue();

      // Restore original secret before verifying
      if (originalSecret !== undefined) {
        process.env.AUTH_GATEWAY_SESSION_SECRET = originalSecret;
      } else {
        delete process.env.AUTH_GATEWAY_SESSION_SECRET;
      }

      const request = new Request("https://example.com/api/test", {
        headers: { "X-Auth-Session": sessionSignedWithWrongSecret },
      });

      // Verification uses the current secret (restored), which differs
      // from what was used to sign, so it should return null
      const session = readGatewaySessionFromRequest(request);
      // This test is meaningful only if the secrets differ; if both are
      // the default dev secret the result may vary — skip assertion if equal
      if (
        (originalSecret || "dev-auth-gateway-secret") !==
        "different-secret-for-signing"
      ) {
        expect(session).toBeNull();
      }
    });

    it("returns null when no X-Auth-Session header and no cookie is set", () => {
      const request = new Request("https://example.com/api/test");

      const session = readGatewaySessionFromRequest(request);
      expect(session).toBeNull();
    });
  });

  /* ---- Requirement 3: cookie still works (backward compatibility) ---- */

  describe("Requirement 3: session cookie continues to work", () => {
    it("returns session payload when gateway session cookie is set", () => {
      const sessionValue = makeValidSessionValue();
      const cookieHeader = `${GATEWAY_SESSION_COOKIE_NAME}=${encodeURIComponent(sessionValue)}`;

      const request = new Request("https://example.com/api/test", {
        headers: { Cookie: cookieHeader },
      });

      const session = readGatewaySessionFromRequest(request);

      expect(session).not.toBeNull();
      expect(session?.userId).toBe(TEST_USER_ID);
      expect(session?.email).toBe(TEST_EMAIL.toLowerCase());
    });

    it("returns null when cookie has invalid value", () => {
      const cookieHeader = `${GATEWAY_SESSION_COOKIE_NAME}=not-a-valid-session`;

      const request = new Request("https://example.com/api/test", {
        headers: { Cookie: cookieHeader },
      });

      const session = readGatewaySessionFromRequest(request);
      expect(session).toBeNull();
    });
  });

  /* ---- Requirement 4: cookie takes precedence over header ---- */

  describe("Requirement 4: cookie takes precedence over X-Auth-Session header", () => {
    it("uses cookie session when both cookie and header are present", () => {
      const cookieUserId = "usr_from_cookie";
      const headerUserId = "usr_from_header";

      const cookieSessionValue = createGatewaySessionCookieValue(
        cookieUserId,
        "cookie@example.com",
      );
      const headerSessionValue = createGatewaySessionCookieValue(
        headerUserId,
        "header@example.com",
      );

      const cookieHeader = `${GATEWAY_SESSION_COOKIE_NAME}=${encodeURIComponent(cookieSessionValue)}`;

      const request = new Request("https://example.com/api/test", {
        headers: {
          Cookie: cookieHeader,
          "X-Auth-Session": headerSessionValue,
        },
      });

      const session = readGatewaySessionFromRequest(request);

      // Cookie takes precedence — the result should come from the cookie
      expect(session).not.toBeNull();
      expect(session?.userId).toBe(cookieUserId);
    });

    it("falls back to X-Auth-Session header when cookie is absent", () => {
      const headerUserId = "usr_from_header_only";
      const headerSessionValue = createGatewaySessionCookieValue(
        headerUserId,
        "header-only@example.com",
      );

      const request = new Request("https://example.com/api/test", {
        headers: {
          "X-Auth-Session": headerSessionValue,
          // No Cookie header
        },
      });

      const session = readGatewaySessionFromRequest(request);

      expect(session).not.toBeNull();
      expect(session?.userId).toBe(headerUserId);
    });
  });
});

/* ------------------------------------------------------------------ */
/*  Integration tests: X-Auth-Session through user-picks POST route    */
/* ------------------------------------------------------------------ */

describe("POST /api/v1/user-picks – X-Auth-Session header integration", () => {
  beforeEach(() => {
    zaddMock.mockReset();
    hsetMock.mockReset();
    expireMock.mockReset();
    zcardMock.mockReset();
    zrevrangeWithScoresMock.mockReset();
    hgetallMock.mockReset();

    zaddMock.mockResolvedValue(1);
    hsetMock.mockResolvedValue("OK");
    expireMock.mockResolvedValue(1);
    zcardMock.mockResolvedValue(1);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  /* ---- Req 1: valid X-Auth-Session header authenticates via route ---- */

  it("route returns 200 with valid X-Auth-Session header", async () => {
    const sessionValue = makeValidSessionValue();
    const request = requestWithHeaderOnly(sessionValue, {
      url: "https://example.com/header-auth-article",
    });

    const response = await POST(request);
    const payload = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(payload.ok).toBe(true);
  });

  /* ---- Req 2: invalid X-Auth-Session header → 401 via route ---- */

  it("route returns 401 with invalid X-Auth-Session header", async () => {
    const request = requestWithHeaderOnly("invalid-tampered-session-value", {
      url: "https://example.com/should-fail",
    });

    const response = await POST(request);
    const payload = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(401);
    expect(payload.ok).toBeFalsy();
    // Redis should not be touched
    expect(zaddMock).not.toHaveBeenCalled();
    expect(hsetMock).not.toHaveBeenCalled();
  });

  /* ---- Req 3: cookie still works via route ---- */

  it("route returns 200 with valid session cookie (backward compat)", async () => {
    const sessionValue = makeValidSessionValue();
    const request = requestWithCookieOnly(sessionValue, {
      url: "https://example.com/cookie-auth-article",
    });

    const response = await POST(request);
    const payload = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(payload.ok).toBe(true);
  });

  /* ---- Req 4: cookie takes precedence (both present) via route ---- */

  it("route uses cookie user when both cookie and X-Auth-Session header are present", async () => {
    const cookieUserId = "usr_cookie_wins";
    const cookieSessionValue = createGatewaySessionCookieValue(
      cookieUserId,
      "cookie-wins@example.com",
    );
    const headerSessionValue = createGatewaySessionCookieValue(
      "usr_header_loses",
      "header-loses@example.com",
    );

    const request = requestWithBoth(cookieSessionValue, headerSessionValue, {
      url: "https://example.com/precedence-test",
    });

    // The route should succeed (cookie is valid)
    const response = await POST(request);
    const payload = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(payload.ok).toBe(true);

    // The zadd key should be based on the cookie user id, not the header user id
    const zaddCalls = zaddMock.mock.calls as Array<[string, number, string]>;
    const picksKeyCall = zaddCalls.find(([key]) => key.includes("user_picks"));
    expect(picksKeyCall).toBeDefined();
    // Key should contain the cookie user id
    expect(picksKeyCall![0]).toContain(cookieUserId);
  });
});
