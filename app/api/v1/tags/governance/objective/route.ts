import { requireArticleDbAuth } from "@/lib/article-db/auth";
import { getTagGovernanceObjective, upsertTagGovernanceObjective } from "@/lib/article-db/repository";
import { jsonResponse } from "@/lib/infra/route-utils";

export const runtime = "nodejs";
export const maxDuration = 300;
export const preferredRegion = ["sin1"];

function objectiveIdFromUrl(url: URL): string {
  return String(url.searchParams.get("objective_id") || "default").trim() || "default";
}

async function parseBody(request: Request): Promise<{ objective_id?: string; config?: Record<string, unknown> }> {
  try {
    const raw = (await request.json()) as Record<string, unknown>;
    if (!raw || typeof raw !== "object") return {};
    const objectiveId = String(raw.objective_id || "").trim();
    const configCandidate = raw.config;
    const config =
      configCandidate && typeof configCandidate === "object" && !Array.isArray(configCandidate)
        ? (configCandidate as Record<string, unknown>)
        : {};
    return {
      objective_id: objectiveId || undefined,
      config,
    };
  } catch {
    return {};
  }
}

export async function GET(request: Request): Promise<Response> {
  const unauthorized = requireArticleDbAuth(request);
  if (unauthorized) {
    return jsonResponse(401, { ok: false, error: unauthorized }, true);
  }
  try {
    const url = new URL(request.url);
    const objectiveId = objectiveIdFromUrl(url);
    const row = await getTagGovernanceObjective(objectiveId);
    return jsonResponse(
      200,
      {
        ok: true,
        generated_at: new Date().toISOString(),
        objective_id: row.objective_id,
        config: row.config_json,
        updated_at: row.updated_at,
      },
      true,
    );
  } catch (error) {
    return jsonResponse(500, { ok: false, error: error instanceof Error ? error.message : String(error) }, true);
  }
}

export async function PUT(request: Request): Promise<Response> {
  const unauthorized = requireArticleDbAuth(request);
  if (unauthorized) {
    return jsonResponse(401, { ok: false, error: unauthorized }, true);
  }
  try {
    const body = await parseBody(request);
    const objectiveId = String(body.objective_id || "default").trim() || "default";
    const config = body.config && typeof body.config === "object" ? body.config : {};
    const row = await upsertTagGovernanceObjective({
      objectiveId,
      configJson: config,
    });

    return jsonResponse(
      200,
      {
        ok: true,
        generated_at: new Date().toISOString(),
        objective_id: row.objective_id,
        config: row.config_json,
        updated_at: row.updated_at,
      },
      true,
    );
  } catch (error) {
    return jsonResponse(400, { ok: false, error: error instanceof Error ? error.message : String(error) }, true);
  }
}
