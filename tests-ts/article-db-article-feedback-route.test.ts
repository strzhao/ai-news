import { afterEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/v1/articles/feedback/route";
import { recordArticleQualityFeedback } from "@/lib/article-db/repository";

vi.mock("@/lib/article-db/repository", () => {
  return {
    recordArticleQualityFeedback: vi.fn(),
  };
});

describe("article-db article feedback route", () => {
  afterEach(() => {
    vi.clearAllMocks();
    delete process.env.ARTICLE_DB_API_TOKEN;
  });

  it("returns 401 when token is required but missing", async () => {
    process.env.ARTICLE_DB_API_TOKEN = "secret-token";
    const response = await POST(
      new Request("https://example.com/api/v1/articles/feedback", {
        method: "POST",
        body: JSON.stringify({
          article_id: "a1",
          feedback: "good",
        }),
      }),
    );
    const payload = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(401);
    expect(payload.ok).toBe(false);
  });

  it("stores good/bad feedback and returns inserted event", async () => {
    process.env.ARTICLE_DB_API_TOKEN = "secret-token";
    vi.mocked(recordArticleQualityFeedback).mockResolvedValue({
      id: "ev_1",
      article_id: "a1",
      feedback: "good",
      feedback_score: 1,
      source_id: "source_1",
      primary_type: "tooling",
      quality_score_snapshot: 80,
      confidence_snapshot: 0.9,
      worth_snapshot: "必读",
      reason_short_snapshot: "reason",
      action_hint_snapshot: "action",
      tag_groups_snapshot: {},
      evidence_signals_snapshot: [],
      context_json: {},
      created_at: "2026-03-01T01:00:00.000Z",
    });

    const response = await POST(
      new Request("https://example.com/api/v1/articles/feedback", {
        method: "POST",
        headers: {
          Authorization: "Bearer secret-token",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          article_id: "a1",
          feedback: "good",
          source: "review-page",
          context: { page: "/archive-review" },
        }),
      }),
    );
    const payload = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(payload.ok).toBe(true);
    expect(recordArticleQualityFeedback).toHaveBeenCalledWith({
      articleId: "a1",
      feedback: "good",
      source: "review-page",
      contextJson: { page: "/archive-review" },
    });
  });

  it("returns 400 for invalid feedback value", async () => {
    process.env.ARTICLE_DB_API_TOKEN = "secret-token";
    const response = await POST(
      new Request("https://example.com/api/v1/articles/feedback", {
        method: "POST",
        headers: {
          Authorization: "Bearer secret-token",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          article_id: "a1",
          feedback: "neutral",
        }),
      }),
    );
    const payload = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(400);
    expect(payload.ok).toBe(false);
    expect(recordArticleQualityFeedback).not.toHaveBeenCalled();
  });
});
