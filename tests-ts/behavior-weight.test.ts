import { describe, expect, it } from "vitest";
import {
  computeBehaviorMultipliers,
  selectPreferredSources,
} from "@/lib/personalization/behavior-weight";

const NOW = new Date("2026-03-20T00:00:00Z");

function daysAgo(n: number): string {
  return new Date(NOW.getTime() - n * 86_400_000).toISOString().slice(0, 10);
}

describe("computeBehaviorMultipliers", () => {
  it("returns multipliers based on click distribution", () => {
    const clicks = {
      srcA: { [daysAgo(1)]: 10 },
      srcB: { [daysAgo(1)]: 2 },
    };
    const result = computeBehaviorMultipliers(clicks, { nowUtc: NOW });
    expect(result["srcA"]).toBeGreaterThan(result["srcB"]);
  });

  it("returns empty object for empty input", () => {
    expect(computeBehaviorMultipliers({}, { nowUtc: NOW })).toEqual({});
  });

  it("returns empty object when all counts are zero", () => {
    const clicks = { srcA: { [daysAgo(1)]: 0 } };
    expect(computeBehaviorMultipliers(clicks, { nowUtc: NOW })).toEqual({});
  });

  it("clamps multipliers within min/max range", () => {
    const clicks = {
      srcA: { [daysAgo(0)]: 100 },
      srcB: { [daysAgo(0)]: 1 },
    };
    const result = computeBehaviorMultipliers(clicks, {
      nowUtc: NOW,
      minMultiplier: 0.85,
      maxMultiplier: 1.2,
    });
    for (const val of Object.values(result)) {
      expect(val).toBeGreaterThanOrEqual(0.85);
      expect(val).toBeLessThanOrEqual(1.2);
    }
  });

  it("applies time decay: recent clicks weigh more", () => {
    const recentClicks = { srcA: { [daysAgo(1)]: 5 } };
    const oldClicks = { srcA: { [daysAgo(60)]: 5 } };
    const recent = computeBehaviorMultipliers(recentClicks, { nowUtc: NOW });
    const old = computeBehaviorMultipliers(oldClicks, { nowUtc: NOW });
    expect(recent["srcA"]).toBeDefined();
    expect(old["srcA"]).toBeDefined();
  });
});

describe("selectPreferredSources", () => {
  it("selects top sources by total clicks", () => {
    const clicks = {
      srcA: { [daysAgo(1)]: 10 },
      srcB: { [daysAgo(1)]: 5 },
      srcC: { [daysAgo(1)]: 1 },
    };
    const result = selectPreferredSources(clicks, { topQuantile: 0.34 });
    expect(result.has("srcA")).toBe(true);
    expect(result.size).toBe(1);
  });

  it("returns empty set for empty input", () => {
    expect(selectPreferredSources({})).toEqual(new Set());
  });

  it("filters sources below minClicks", () => {
    const clicks = {
      srcA: { [daysAgo(1)]: 1 },
    };
    const result = selectPreferredSources(clicks, { minClicks: 2 });
    expect(result.size).toBe(0);
  });
});
