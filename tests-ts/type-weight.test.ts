import { describe, expect, it } from "vitest";
import { computeTypeMultipliers } from "@/lib/personalization/type-weight";

const NOW = new Date("2026-03-20T00:00:00Z");

function daysAgo(n: number): string {
  return new Date(NOW.getTime() - n * 86_400_000).toISOString().slice(0, 10);
}

describe("computeTypeMultipliers", () => {
  it("returns multipliers reflecting click distribution across types", () => {
    const clicks = {
      news: { [daysAgo(1)]: 20 },
      research: { [daysAgo(1)]: 5 },
    };
    const result = computeTypeMultipliers(clicks, { nowUtc: NOW });
    expect(result["news"]).toBeGreaterThan(result["research"]);
  });

  it("returns empty object when no history data", () => {
    expect(computeTypeMultipliers({}, { nowUtc: NOW })).toEqual({});
  });

  it("returns empty object when all counts are zero", () => {
    const clicks = { news: { [daysAgo(1)]: 0 }, research: { [daysAgo(1)]: 0 } };
    expect(computeTypeMultipliers(clicks, { nowUtc: NOW })).toEqual({});
  });

  it("clamps multipliers within default 0.9-1.15 range", () => {
    const clicks = {
      news: { [daysAgo(0)]: 100 },
      research: { [daysAgo(0)]: 1 },
    };
    const result = computeTypeMultipliers(clicks, { nowUtc: NOW });
    for (const val of Object.values(result)) {
      expect(val).toBeGreaterThanOrEqual(0.9);
      expect(val).toBeLessThanOrEqual(1.15);
    }
  });

  it("handles single type input", () => {
    const clicks = { news: { [daysAgo(1)]: 10 } };
    const result = computeTypeMultipliers(clicks, { nowUtc: NOW });
    expect(result["news"]).toBe(1);
  });

  it("ignores clicks outside lookback window", () => {
    const clicks = { news: { [daysAgo(100)]: 50 } };
    const result = computeTypeMultipliers(clicks, {
      nowUtc: NOW,
      lookbackDays: 30,
    });
    expect(result).toEqual({});
  });
});
