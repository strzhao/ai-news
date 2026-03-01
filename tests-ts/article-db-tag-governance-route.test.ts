import { afterEach, describe, expect, it, vi } from "vitest";
import { GET as GET_OBJECTIVE, PUT as PUT_OBJECTIVE } from "@/app/api/v1/tags/governance/objective/route";
import { POST as POST_RUN } from "@/app/api/v1/tags/governance/run/route";
import { getTagGovernanceObjective, upsertTagGovernanceObjective } from "@/lib/article-db/repository";
import { runTagGovernance } from "@/lib/article-db/tag-governance";

vi.mock("@/lib/article-db/repository", () => {
  return {
    getTagGovernanceObjective: vi.fn(),
    upsertTagGovernanceObjective: vi.fn(),
  };
});

vi.mock("@/lib/article-db/tag-governance", () => {
  return {
    runTagGovernance: vi.fn(),
  };
});

describe("article-db tag governance routes", () => {
  afterEach(() => {
    vi.clearAllMocks();
    delete process.env.ARTICLE_DB_API_TOKEN;
  });

  it("gets governance objective", async () => {
    process.env.ARTICLE_DB_API_TOKEN = "secret-token";
    vi.mocked(getTagGovernanceObjective).mockResolvedValue({
      objective_id: "default",
      config_json: {
        mission: "test",
      },
      updated_at: "2026-03-01T00:00:00.000Z",
    });

    const response = await GET_OBJECTIVE(
      new Request("https://example.com/api/v1/tags/governance/objective?objective_id=default", {
        headers: {
          Authorization: "Bearer secret-token",
        },
      }),
    );

    const payload = (await response.json()) as Record<string, unknown>;
    expect(response.status).toBe(200);
    expect(payload.ok).toBe(true);
    expect(payload.objective_id).toBe("default");
  });

  it("updates governance objective", async () => {
    process.env.ARTICLE_DB_API_TOKEN = "secret-token";
    vi.mocked(upsertTagGovernanceObjective).mockResolvedValue({
      objective_id: "default",
      config_json: {
        mission: "updated",
      },
      updated_at: "2026-03-01T00:00:00.000Z",
    });

    const response = await PUT_OBJECTIVE(
      new Request("https://example.com/api/v1/tags/governance/objective", {
        method: "PUT",
        headers: {
          Authorization: "Bearer secret-token",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          objective_id: "default",
          config: {
            mission: "updated",
          },
        }),
      }),
    );

    const payload = (await response.json()) as Record<string, unknown>;
    expect(response.status).toBe(200);
    expect(payload.ok).toBe(true);
    expect(upsertTagGovernanceObjective).toHaveBeenCalledWith({
      objectiveId: "default",
      configJson: {
        mission: "updated",
      },
    });
  });

  it("runs governance workflow with ai-first planner and critic", async () => {
    process.env.ARTICLE_DB_API_TOKEN = "secret-token";
    vi.mocked(runTagGovernance).mockResolvedValue({
      ok: true,
      runId: "run_1",
      objectiveId: "default",
      dryRun: true,
      context: {},
      plannedActions: [
        {
          type: "add_alias",
          group_key: "topic",
          tag_key: "agent",
          aliases: ["multi_agent"],
        },
      ],
      finalActions: [
        {
          type: "add_alias",
          group_key: "topic",
          tag_key: "agent",
          aliases: ["multi_agent"],
        },
      ],
      applied: [
        {
          ok: true,
          preview: true,
        },
      ],
      planner: {
        summary: "planner",
      },
      critic: {
        summary: "critic",
      },
    });

    const response = await POST_RUN(
      new Request("https://example.com/api/v1/tags/governance/run", {
        method: "POST",
        headers: {
          Authorization: "Bearer secret-token",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          dry_run: true,
          lookback_days: 14,
          max_actions: 6,
          focus_groups: ["topic"],
        }),
      }),
    );

    const payload = (await response.json()) as Record<string, unknown>;
    expect(response.status).toBe(200);
    expect(payload.ok).toBe(true);
    expect(payload.run_id).toBe("run_1");
    expect(runTagGovernance).toHaveBeenCalledWith({
      objectiveId: "default",
      dryRun: true,
      lookbackDays: 14,
      maxActions: 6,
      sampleLimit: 800,
      focusGroups: ["topic"],
      extraContext: "",
      candidateActions: undefined,
    });
  });
});
