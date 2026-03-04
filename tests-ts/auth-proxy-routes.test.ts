import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as logout } from "@/app/api/auth/logout/route";
import { GET as me } from "@/app/api/auth/me/route";

describe("auth proxy routes", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    process.env.AUTH_ISSUER = "https://user.stringzhao.life";
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("proxies /api/auth/me to auth center with forwarded headers", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ id: "usr_1", email: "user@example.com", status: "ACTIVE" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    const response = await me(
      new Request("https://ai-news.stringzhao.life/api/auth/me", {
        headers: {
          cookie: "access_token=abc; refresh_token=def",
          authorization: "Bearer token-x",
          "user-agent": "Vitest",
        },
      }),
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [target, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(target).toBe("https://user.stringzhao.life/api/auth/me");
    expect(init.method).toBe("GET");
    const headers = new Headers(init.headers as HeadersInit);
    expect(headers.get("cookie")).toContain("access_token=abc");
    expect(headers.get("authorization")).toBe("Bearer token-x");
    expect(headers.get("user-agent")).toBe("Vitest");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      id: "usr_1",
      email: "user@example.com",
      status: "ACTIVE",
    });
  });

  it("proxies /api/auth/logout and forwards set-cookie", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: new Headers([
          ["content-type", "application/json"],
          ["set-cookie", "refresh_token=; Max-Age=0; Path=/; Domain=.stringzhao.life; HttpOnly; Secure"],
        ]),
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

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [target, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(target).toBe("https://user.stringzhao.life/api/auth/logout");
    expect(init.method).toBe("POST");

    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie") || "").toContain("refresh_token=");
    await expect(response.json()).resolves.toEqual({ success: true });
  });

  it("returns 502 when auth center is unavailable", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("upstream timeout"));

    const response = await me(new Request("https://ai-news.stringzhao.life/api/auth/me"));
    const payload = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(502);
    expect(payload.ok).toBe(false);
    expect(payload.error).toBe("auth_upstream_unavailable");
    expect(String(payload.message || "")).toContain("upstream timeout");
  });
});
