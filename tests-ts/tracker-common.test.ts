import { describe, expect, it } from "vitest";
import { normalizeUrl, signParams, verifySignature } from "@/lib/domain/tracker-common";

describe("tracker common", () => {
  it("verifySignature is compatible with signParams", () => {
    const params = {
      u: "https://example.com/a?utm_source=x",
      sid: "source_1",
      aid: "article_1",
      d: "2026-02-28",
      ch: "markdown",
    };
    const secret = "unit-test-secret";
    const sig = signParams(params, secret);
    expect(verifySignature(params, sig, secret)).toBe(true);
  });

  it("normalizeUrl removes tracking params and normalizes host", () => {
    const normalized = normalizeUrl("https://Example.com/Path/?utm_source=x&fbclid=y&id=1");
    expect(normalized).toContain("example.com");
    expect(normalized).toContain("id=1");
    expect(normalized).not.toContain("utm_source");
    expect(normalized).not.toContain("fbclid");
  });
});
