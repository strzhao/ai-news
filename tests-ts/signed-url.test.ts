import { describe, expect, it } from "vitest";
import { buildSignedTrackingUrl } from "@/lib/tracking/signed-url";

describe("buildSignedTrackingUrl", () => {
  const base = "https://example.com";
  const secret = "test-secret";

  it("builds a URL with params and sig", () => {
    const url = buildSignedTrackingUrl(
      base,
      { u: "https://target.com", src: "email" },
      secret,
    );
    const parsed = new URL(url);
    expect(parsed.pathname).toBe("/api/r");
    expect(parsed.searchParams.get("u")).toBe("https://target.com");
    expect(parsed.searchParams.get("src")).toBe("email");
    expect(parsed.searchParams.get("sig")).toBeTruthy();
  });

  it("produces the same signature for identical inputs", () => {
    const params = { u: "https://a.com", src: "web" };
    const url1 = buildSignedTrackingUrl(base, params, secret);
    const url2 = buildSignedTrackingUrl(base, params, secret);
    expect(url1).toBe(url2);
  });

  it("produces different signatures for different params", () => {
    const url1 = buildSignedTrackingUrl(base, { u: "https://a.com" }, secret);
    const url2 = buildSignedTrackingUrl(base, { u: "https://b.com" }, secret);
    const sig1 = new URL(url1).searchParams.get("sig");
    const sig2 = new URL(url2).searchParams.get("sig");
    expect(sig1).not.toBe(sig2);
  });

  it("produces different signatures for different secrets", () => {
    const params = { u: "https://a.com" };
    const url1 = buildSignedTrackingUrl(base, params, "secret-1");
    const url2 = buildSignedTrackingUrl(base, params, "secret-2");
    const sig1 = new URL(url1).searchParams.get("sig");
    const sig2 = new URL(url2).searchParams.get("sig");
    expect(sig1).not.toBe(sig2);
  });

  it("skips empty-value params", () => {
    const url = buildSignedTrackingUrl(
      base,
      { u: "https://a.com", empty: "", blank: "  " },
      secret,
    );
    const parsed = new URL(url);
    expect(parsed.searchParams.has("empty")).toBe(false);
    expect(parsed.searchParams.has("blank")).toBe(false);
    expect(parsed.searchParams.has("u")).toBe(true);
  });
});
