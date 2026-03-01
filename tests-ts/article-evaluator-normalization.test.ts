import { describe, expect, it } from "vitest";
import { ArticleEvaluator } from "@/lib/llm/article-evaluator";

describe("article evaluator normalization", () => {
  const evaluator = new ArticleEvaluator({} as any, {} as any, [
    "strategic_analysis",
    "engineering_practice",
    "research_progress",
    "open_source_project",
    "other",
  ]);

  it("promotes specific secondary type when primary_type is other", () => {
    const parsed = (evaluator as any).parseAssessment("a1", {
      article_id: "a1",
      worth: "可读",
      reading_roi_score: 65,
      company_impact: 60,
      team_impact: 55,
      personal_impact: 50,
      execution_clarity: 40,
      novelty: 45,
      clarity_score: 60,
      one_line_summary: "summary",
      reason_short: "reason",
      action_hint: "hint",
      best_for_roles: ["AI 工程师"],
      evidence_signals: ["benchmark"],
      confidence: 0.95,
      primary_type: "other",
      secondary_types: ["research_progress", "other"],
      tag_groups: {},
    });

    expect(parsed.primaryType).toBe("research_progress");
    expect(parsed.secondaryTypes).not.toContain("research_progress");
    expect(parsed.tagGroups.type).toContain("research_progress");
  });

  it("promotes type from type_candidates when primary_type is other", () => {
    const parsed = (evaluator as any).parseAssessment("a1b", {
      article_id: "a1b",
      worth: "可读",
      reading_roi_score: 58,
      company_impact: 55,
      team_impact: 55,
      personal_impact: 55,
      execution_clarity: 45,
      novelty: 50,
      clarity_score: 55,
      one_line_summary: "summary",
      reason_short: "reason",
      action_hint: "hint",
      best_for_roles: ["技术负责人"],
      evidence_signals: ["benchmark"],
      confidence: 0.88,
      primary_type: "other",
      secondary_types: [],
      type_candidates: ["strategic_analysis", "other"],
      tag_groups: {},
    });

    expect(parsed.primaryType).toBe("strategic_analysis");
    expect(parsed.tagGroups.type).toContain("strategic_analysis");
  });

  it("parses JSON-string tag_groups and normalizes to snake_case", () => {
    const parsed = (evaluator as any).parseAssessment("a2", {
      article_id: "a2",
      worth: "可读",
      reading_roi_score: 62,
      company_impact: 62,
      team_impact: 62,
      personal_impact: 62,
      execution_clarity: 62,
      novelty: 62,
      clarity_score: 62,
      one_line_summary: "summary",
      reason_short: "reason",
      action_hint: "hint",
      best_for_roles: [],
      evidence_signals: ["open source"],
      confidence: 0.9,
      primary_type: "open_source_project",
      secondary_types: [],
      tag_groups: "{\"topic\":[\"multi agent\", \"RAG\"], \"role\": \"AI engineer\"}",
    });

    expect(parsed.tagGroups.topic).toEqual(["multi_agent", "rag"]);
    expect(parsed.tagGroups.role).toEqual(["ai_engineer"]);
  });

  it("caps confidence for low-quality weakly-grounded outputs", () => {
    const parsed = (evaluator as any).parseAssessment("a3", {
      article_id: "a3",
      worth: "跳过",
      reading_roi_score: 1,
      company_impact: 1,
      team_impact: 1,
      personal_impact: 1,
      execution_clarity: 1,
      novelty: 1,
      clarity_score: 1,
      one_line_summary: "summary",
      reason_short: "reason",
      action_hint: "",
      best_for_roles: [],
      evidence_signals: [],
      confidence: 1,
      primary_type: "other",
      secondary_types: [],
      tag_groups: {},
    });

    expect(parsed.confidence).toBeLessThanOrEqual(0.7);
    expect(parsed.tagGroups.type).toEqual(["other"]);
  });
});
