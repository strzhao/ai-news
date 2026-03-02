import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/v1/observability/ai/route";
import { listRecentIngestionRuns } from "@/lib/article-db/ingestion-runs";

vi.mock("@/lib/article-db/ingestion-runs", () => {
  return {
    listRecentIngestionRuns: vi.fn(),
  };
});

describe("article-db ai observability route", () => {
  afterEach(() => {
    vi.clearAllMocks();
    delete process.env.ARTICLE_DB_API_TOKEN;
  });

  it("returns 401 when token is required but authorization is missing", async () => {
    process.env.ARTICLE_DB_API_TOKEN = "secret-token";

    const response = await GET(new Request("https://example.com/api/v1/observability/ai"));
    const payload = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(401);
    expect(payload.ok).toBe(false);
  });

  it("returns summarized ai observability payload", async () => {
    process.env.ARTICLE_DB_API_TOKEN = "secret-token";

    vi.mocked(listRecentIngestionRuns).mockResolvedValue([
      {
        id: "run_2",
        run_date: "2026-03-02",
        status: "success",
        started_at: "2026-03-02T01:00:00.000Z",
        heartbeat_at: "2026-03-02T01:00:40.000Z",
        finished_at: "2026-03-02T01:00:45.000Z",
        fetched_count: 30,
        deduped_count: 20,
        analyzed_count: 18,
        selected_count: 9,
        error_message: "",
        stats_json: {
          ai_eval_total_candidates: 20,
          ai_eval_evaluated_success: 18,
          ai_eval_evaluated_failed: 2,
          ai_eval_cache_hit: 4,
          ai_eval_cache_miss: 16,
          ai_eval_latency_ms_p90: 920,
          ai_eval_error_type_counts: {
            invalid_json: 2,
          },
          ai_eval_failed_samples: [
            {
              article_id: "a1",
              source_id: "s1",
              error_type: "invalid_json",
              error_message: "Model output is not valid JSON",
              truncated_model_output: "{...}",
            },
          ],
        },
      },
      {
        id: "run_1",
        run_date: "2026-03-02",
        status: "failed",
        started_at: "2026-03-02T00:00:00.000Z",
        heartbeat_at: "2026-03-02T00:00:20.000Z",
        finished_at: "2026-03-02T00:00:25.000Z",
        fetched_count: 12,
        deduped_count: 10,
        analyzed_count: 0,
        selected_count: 0,
        error_message: "DeepSeek request failed",
        stats_json: {
          ai_eval_total_candidates: 10,
          ai_eval_evaluated_success: 0,
          ai_eval_evaluated_failed: 10,
          ai_eval_cache_hit: 0,
          ai_eval_cache_miss: 10,
          ai_eval_latency_ms_p90: 0,
          ai_eval_error_type_counts: {
            http_error: 10,
          },
          ai_eval_failed_samples: [],
        },
      },
    ] as any);

    const response = await GET(
      new Request("https://example.com/api/v1/observability/ai?limit=10&days=2", {
        headers: {
          Authorization: "Bearer secret-token",
        },
      }),
    );
    const payload = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(payload.ok).toBe(true);
    expect(listRecentIngestionRuns).toHaveBeenCalledWith({ limit: 10, days: 2 });
    expect((payload.summary as Record<string, unknown>).run_count).toBe(2);
    expect((payload.summary as Record<string, unknown>).run_success_count).toBe(1);
    expect((payload.summary as Record<string, unknown>).run_failed_count).toBe(1);
    expect((payload.summary as Record<string, unknown>).ai_eval_total_candidates).toBe(30);
    expect((payload.summary as Record<string, unknown>).ai_eval_total_failed).toBe(12);
    expect(Array.isArray(payload.runs)).toBe(true);
    expect(Array.isArray(payload.latest_failed_samples)).toBe(true);
    expect((payload.latest_failed_samples as Array<unknown>).length).toBe(1);
  });
});
