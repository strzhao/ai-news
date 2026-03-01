import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/v1/ingestion/run/route";
import { runIngestionWithResult } from "@/lib/article-db/ingestion-runner";

vi.mock("@/lib/article-db/ingestion-runner", () => {
  return {
    runIngestionWithResult: vi.fn(),
  };
});

describe("article-db ingestion route", () => {
  afterEach(() => {
    vi.clearAllMocks();
    delete process.env.CRON_SECRET;
  });

  it("returns 401 when cron secret does not match", async () => {
    process.env.CRON_SECRET = "expected";

    const response = await GET(new Request("https://example.com/api/v1/ingestion/run?token=wrong"));
    const payload = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(401);
    expect(payload.ok).toBe(false);
  });

  it("returns ingestion result when authorized", async () => {
    process.env.CRON_SECRET = "expected";
    vi.mocked(runIngestionWithResult).mockResolvedValue({
      ok: true,
      runId: "run_1",
      reportDate: "2026-03-01",
      timezone: "Asia/Shanghai",
      fetchedCount: 20,
      dedupedCount: 12,
      evaluatedCount: 12,
      selectedCount: 8,
      qualityThreshold: 62,
      stats: { selected_count: 8 },
      errorMessage: "",
    });

    const response = await GET(
      new Request("https://example.com/api/v1/ingestion/run?date=2026-03-01", {
        headers: {
          Authorization: "Bearer expected",
        },
      }),
    );
    const payload = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(payload.ok).toBe(true);
    expect(payload.report_date).toBe("2026-03-01");
    expect(runIngestionWithResult).toHaveBeenCalledWith({
      date: "2026-03-01",
      tz: undefined,
    });
  });
});
