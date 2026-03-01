import { afterEach, describe, expect, it, vi } from "vitest";
import { GET, POST } from "@/app/api/v1/tags/governance/feedback/route";
import { appendTagGovernanceFeedback, listTagGovernanceFeedbackStats } from "@/lib/article-db/repository";

vi.mock("@/lib/article-db/repository", () => {
  return {
    appendTagGovernanceFeedback: vi.fn(),
    listTagGovernanceFeedbackStats: vi.fn(),
  };
});

describe("article-db tag governance feedback route", () => {
  afterEach(() => {
    vi.clearAllMocks();
    delete process.env.ARTICLE_DB_API_TOKEN;
  });

  it("lists feedback stats", async () => {
    process.env.ARTICLE_DB_API_TOKEN = "secret-token";
    vi.mocked(listTagGovernanceFeedbackStats).mockResolvedValue([
      {
        objective_id: "default",
        event_type: "retrieval_hit",
        group_key: "topic",
        tag_key: "agent",
        event_count: 2,
        avg_score: 0.8,
        total_weight: 2,
        last_seen: "2026-03-01T00:00:00.000Z",
      },
    ]);

    const response = await GET(
      new Request("https://example.com/api/v1/tags/governance/feedback?objective_id=default&days=30&limit=20", {
        headers: { Authorization: "Bearer secret-token" },
      }),
    );
    const payload = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(payload.ok).toBe(true);
    expect(payload.stat_count).toBe(1);
    expect(listTagGovernanceFeedbackStats).toHaveBeenCalledWith({
      objectiveId: "default",
      days: 30,
      limit: 20,
    });
  });

  it("ingests feedback events", async () => {
    process.env.ARTICLE_DB_API_TOKEN = "secret-token";
    vi.mocked(appendTagGovernanceFeedback).mockResolvedValue({
      id: "evt_1",
      objective_id: "default",
      event_type: "retrieval_hit",
      group_key: "topic",
      tag_key: "agent",
      score: 1,
      weight: 1,
      source: "search_api",
      context_json: {},
      created_at: "2026-03-01T00:00:00.000Z",
    });

    const response = await POST(
      new Request("https://example.com/api/v1/tags/governance/feedback", {
        method: "POST",
        headers: {
          Authorization: "Bearer secret-token",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          objective_id: "default",
          events: [
            {
              event_type: "retrieval_hit",
              group_key: "topic",
              tag_key: "agent",
              score: 1,
              weight: 1,
              source: "search_api",
            },
          ],
        }),
      }),
    );
    const payload = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(payload.ok).toBe(true);
    expect(payload.inserted_count).toBe(1);
    expect(appendTagGovernanceFeedback).toHaveBeenCalledWith({
      objectiveId: "default",
      eventType: "retrieval_hit",
      groupKey: "topic",
      tagKey: "agent",
      score: 1,
      weight: 1,
      source: "search_api",
      contextJson: {},
    });
  });
});
