import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as logout } from "@/app/api/auth/logout/route";
import { GET as me } from "@/app/api/auth/me/route";
import {
  createGatewaySessionCookieValue,
  GATEWAY_SESSION_COOKIE_NAME,
} from "@/lib/auth/gateway-session";

describe("auth proxy routes", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    process.env.AUTH_ISSUER = "https://user.stringzhao.life";
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("/api/auth/me returns user data from gateway session cookie", async () => {
    const cookieValue = createGatewaySessionCookieValue(
      "usr_1",
      "user@example.com",
    );

    const response = await me(
      new Request("https://ai-news.stringzhao.life/api/auth/me", {
        headers: {
          cookie: `${GATEWAY_SESSION_COOKIE_NAME}=${cookieValue}`,
        },
      }),
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.id).toBe("usr_1");
    expect(body.email).toBe("user@example.com");
    expect(body.status).toBe("ACTIVE");
  });

  it("/api/auth/me returns 401 without session cookie", async () => {
    const response = await me(
      new Request("https://ai-news.stringzhao.life/api/auth/me"),
    );

    expect(response.status).toBe(401);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.error).toBe("unauthorized");
  });

  it("/api/auth/logout proxies to auth center and clears gateway session", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: new Headers([["content-type", "application/json"]]),
      }),
    );

    const response = await logout(
      new Request("https://ai-news.stringzhao.life/api/auth/logout", {
        method: "POST",
        headers: {
          cookie: "refresh_token=abc",
        },
      }),
    );

    expect(response.status).toBe(200);
    // Should clear the gateway session cookie (Max-Age=0)
    const setCookie = response.headers.get("set-cookie") || "";
    expect(setCookie).toContain(GATEWAY_SESSION_COOKIE_NAME);
    expect(setCookie).toContain("Max-Age=0");
  });

  it("/api/auth/logout returns 502 when auth center is unavailable", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(
      new Error("upstream timeout"),
    );

    const response = await logout(
      new Request("https://ai-news.stringzhao.life/api/auth/logout", {
        method: "POST",
      }),
    );

    // proxyAuthCenter returns 502 which becomes the response status
    expect(response.status).toBe(502);
    // gateway session cookie is still cleared
    const setCookie = response.headers.get("set-cookie") || "";
    expect(setCookie).toContain(GATEWAY_SESSION_COOKIE_NAME);
  });
});
