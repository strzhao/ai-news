import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  countHighlights,
  firstNonEmptyLine,
  isEnabled,
  isTruthy,
} from "@/lib/infra/route-utils";

describe("isTruthy", () => {
  it("returns true for truthy strings", () => {
    for (const v of ["1", "true", "yes", "on", "TRUE", " Yes ", " ON "]) {
      expect(isTruthy(v)).toBe(true);
    }
  });

  it("returns false for non-truthy strings", () => {
    for (const v of ["0", "false", "no", "off", "random", ""]) {
      expect(isTruthy(v)).toBe(false);
    }
  });

  it("handles null/undefined coercion", () => {
    expect(isTruthy(undefined as unknown as string)).toBe(false);
    expect(isTruthy(null as unknown as string)).toBe(false);
  });
});

describe("isEnabled", () => {
  const ENV_KEY = "__TEST_IS_ENABLED__";

  afterEach(() => {
    delete process.env[ENV_KEY];
  });

  it("returns true when env is not set (default 'true')", () => {
    expect(isEnabled(ENV_KEY)).toBe(true);
  });

  it("returns false when env is '0' or 'false'", () => {
    process.env[ENV_KEY] = "0";
    expect(isEnabled(ENV_KEY)).toBe(false);
    process.env[ENV_KEY] = "false";
    expect(isEnabled(ENV_KEY)).toBe(false);
    process.env[ENV_KEY] = "off";
    expect(isEnabled(ENV_KEY)).toBe(false);
  });

  it("respects custom default value", () => {
    expect(isEnabled(ENV_KEY, "false")).toBe(false);
    expect(isEnabled(ENV_KEY, "0")).toBe(false);
  });
});

describe("firstNonEmptyLine", () => {
  it("returns first non-empty line", () => {
    expect(firstNonEmptyLine("\n\n  hello\nworld")).toBe("hello");
  });

  it("returns empty string for empty input", () => {
    expect(firstNonEmptyLine("")).toBe("");
    expect(firstNonEmptyLine("\n\n\n")).toBe("");
  });

  it("handles null/undefined coercion", () => {
    expect(firstNonEmptyLine(null as unknown as string)).toBe("");
  });
});

describe("countHighlights", () => {
  it("counts lines starting with ### ", () => {
    const md = "### One\nSome text\n### Two\n### Three";
    expect(countHighlights(md)).toBe(3);
  });

  it("returns 0 for no highlights", () => {
    expect(countHighlights("hello\nworld")).toBe(0);
    expect(countHighlights("")).toBe(0);
  });

  it("does not count #### or ## ", () => {
    expect(countHighlights("## Two\n#### Four")).toBe(0);
  });
});
