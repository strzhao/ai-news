import { requireArticleDbAuth } from "@/lib/article-db/auth";
import { runTagGovernance } from "@/lib/article-db/tag-governance";
import { jsonResponse } from "@/lib/infra/route-utils";

export const runtime = "nodejs";
export const maxDuration = 300;
export const preferredRegion = ["sin1"];

interface RunBody {
  objective_id?: string;
  dry_run?: boolean;
  lookback_days?: number;
  max_actions?: number;
  sample_limit?: number;
  focus_groups?: string[];
  extra_context?: string;
  candidate_actions?: unknown;
}

async function parseBody(request: Request): Promise<RunBody> {
  try {
    const raw = (await request.json()) as RunBody;
    if (!raw || typeof raw !== "object") return {};
    return raw;
  } catch {
    return {};
  }
}

function asNumber(value: unknown, fallback: number): number {
  const parsed = Number.parseInt(String(value ?? fallback), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return parsed;
}

export async function POST(request: Request): Promise<Response> {
  const unauthorized = requireArticleDbAuth(request);
  if (unauthorized) {
    return jsonResponse(401, { ok: false, error: unauthorized }, true);
  }

  try {
    const body = await parseBody(request);
    const result = await runTagGovernance({
      objectiveId: String(body.objective_id || "default").trim() || "default",
      dryRun: body.dry_run !== undefined ? Boolean(body.dry_run) : true,
      lookbackDays: asNumber(body.lookback_days, 30),
      maxActions: asNumber(body.max_actions, 12),
      sampleLimit: asNumber(body.sample_limit, 800),
      focusGroups: Array.isArray(body.focus_groups) ? body.focus_groups.map((item) => String(item || "")) : [],
      extraContext: String(body.extra_context || "").trim(),
      candidateActions: body.candidate_actions,
    });

    return jsonResponse(
      200,
      {
        ok: true,
        generated_at: new Date().toISOString(),
        run_id: result.runId,
        objective_id: result.objectiveId,
        dry_run: result.dryRun,
        planned_action_count: result.plannedActions.length,
        final_action_count: result.finalActions.length,
        applied_action_count: result.applied.length,
        planned_actions: result.plannedActions,
        final_actions: result.finalActions,
        applied: result.applied,
        planner: result.planner,
        critic: result.critic,
      },
      true,
    );
  } catch (error) {
    return jsonResponse(500, { ok: false, error: error instanceof Error ? error.message : String(error) }, true);
  }
}
