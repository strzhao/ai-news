import { describe, expect, it } from "vitest";
import { analysisArchiveEnabled, buildDigestArgv } from "@/lib/routes/cron-digest-helpers";

describe("cron digest route helpers", () => {
  it("buildDigestArgv supports defaults", () => {
    const argv = buildDigestArgv(new URL("https://example.com/api/cron_digest"), "Asia/Shanghai", "/tmp/reports");
    expect(argv).toEqual(["vercel-cron", "--tz", "Asia/Shanghai", "--output-dir", "/tmp/reports"]);
  });

  it("buildDigestArgv supports query params", () => {
    const argv = buildDigestArgv(
      new URL("https://example.com/api/cron_digest?date=2026-02-28&ignore_repeat_limit=1&top_n=12"),
      "Asia/Shanghai",
      "/tmp/reports",
    );
    expect(argv).toEqual([
      "vercel-cron",
      "--tz",
      "Asia/Shanghai",
      "--output-dir",
      "/tmp/reports",
      "--date",
      "2026-02-28",
      "--top-n",
      "12",
      "--ignore-repeat-limit",
    ]);
  });

  it("analysisArchiveEnabled is false by default", () => {
    delete process.env.ARCHIVE_ANALYSIS_ENABLED;
    expect(analysisArchiveEnabled(new URL("https://example.com/api/cron_digest"))).toBe(false);
  });

  it("analysisArchiveEnabled supports query override", () => {
    expect(analysisArchiveEnabled(new URL("https://example.com/api/cron_digest?archive_analysis=1"))).toBe(true);
  });
});
