import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/cron_digest/route";
import { runDigestWithResult } from "@/lib/digest-runner";

vi.mock("@/lib/digest-runner", () => {
  return {
    runDigestWithResult: vi.fn(),
  };
});

describe("cron_digest route", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = {
      ...originalEnv,
      ARCHIVE_ENABLED: "false",
      CRON_SECRET: "",
      DIGEST_MANUAL_TOKEN: "",
    };
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("returns exit_code=0 as success", async () => {
    vi.mocked(runDigestWithResult).mockResolvedValue({
      exitCode: 0,
      reportDate: "2026-03-01",
      timezoneName: "Asia/Shanghai",
      outputDir: "/tmp/reports",
      reportPath: "/tmp/reports/2026-03-01.md",
      reportMarkdown: "## 今日速览\n\n## 重点文章\n### 1. [A](https://example.com)",
      topSummary: "summary",
      highlightCount: 1,
      hasHighlights: true,
      analysisPath: "",
      analysisMarkdown: "",
      analysisJson: {},
      stats: {},
    });

    const request = new Request("https://example.com/api/cron_digest");
    const response = await GET(request);
    const payload = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(payload.ok).toBe(true);
    expect(payload.exit_code).toBe(0);
  });
});
