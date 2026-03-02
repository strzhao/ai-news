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
    vi.restoreAllMocks();
    vi.useRealTimers();
    delete process.env.CRON_SECRET;
    delete process.env.INGESTION_CRON_JITTER_MAX_SECONDS;
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
    expect(payload.trigger_type).toBe("manual");
    expect(payload.jitter_delay_ms).toBe(0);
    expect(runIngestionWithResult).toHaveBeenCalledWith({
      date: "2026-03-01",
      tz: undefined,
    });
  });

  it("supports cron trigger with skip_jitter=1", async () => {
    process.env.CRON_SECRET = "expected";
    process.env.INGESTION_CRON_JITTER_MAX_SECONDS = "120";
    vi.mocked(runIngestionWithResult).mockResolvedValue({
      ok: true,
      runId: "run_2",
      reportDate: "2026-03-01",
      timezone: "Asia/Shanghai",
      fetchedCount: 10,
      dedupedCount: 8,
      evaluatedCount: 7,
      selectedCount: 4,
      qualityThreshold: 62,
      stats: {},
      errorMessage: "",
    });

    const response = await GET(
      new Request("https://example.com/api/v1/ingestion/run?skip_jitter=1", {
        headers: {
          Authorization: "Bearer expected",
          "x-vercel-cron": "1",
        },
      }),
    );
    const payload = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(payload.ok).toBe(true);
    expect(payload.trigger_type).toBe("cron");
    expect(payload.jitter_delay_ms).toBe(0);
  });

  it("applies cron jitter delay before ingestion execution", async () => {
    process.env.CRON_SECRET = "expected";
    process.env.INGESTION_CRON_JITTER_MAX_SECONDS = "1";
    vi.useFakeTimers();
    const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0.5);
    vi.mocked(runIngestionWithResult).mockResolvedValue({
      ok: true,
      runId: "run_3",
      reportDate: "2026-03-01",
      timezone: "Asia/Shanghai",
      fetchedCount: 10,
      dedupedCount: 8,
      evaluatedCount: 7,
      selectedCount: 4,
      qualityThreshold: 62,
      stats: {},
      errorMessage: "",
    });

    const responsePromise = GET(
      new Request("https://example.com/api/v1/ingestion/run", {
        headers: {
          Authorization: "Bearer expected",
          "x-vercel-cron": "1",
        },
      }),
    );

    await vi.advanceTimersByTimeAsync(499);
    expect(runIngestionWithResult).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    const response = await responsePromise;
    const payload = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(payload.trigger_type).toBe("cron");
    expect(payload.jitter_delay_ms).toBe(500);
    expect(runIngestionWithResult).toHaveBeenCalledTimes(1);
    randomSpy.mockRestore();
  });
});
