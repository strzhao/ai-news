import { requireArticleDbAuth } from "@/lib/article-db/auth";
import { appendTagGovernanceFeedback, listTagGovernanceFeedbackStats } from "@/lib/article-db/repository";
import { jsonResponse } from "@/lib/infra/route-utils";

export const runtime = "nodejs";
export const maxDuration = 300;
export const preferredRegion = ["sin1"];

interface FeedbackEventBody {
  objective_id?: string;
  event_type?: string;
  group_key?: string;
  tag_key?: string;
  score?: number;
  weight?: number;
  source?: string;
  context?: Record<string, unknown>;
}

interface FeedbackBody {
  objective_id?: string;
  events?: FeedbackEventBody[];
  event?: FeedbackEventBody;
}

function parseIntSafe(value: string | null, fallback: number): number {
  const parsed = Number.parseInt(String(value || fallback), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return parsed;
}

async function parseBody(request: Request): Promise<FeedbackBody> {
  try {
    const body = (await request.json()) as FeedbackBody;
    if (!body || typeof body !== "object") return {};
    return body;
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
    const objectiveId = String(url.searchParams.get("objective_id") || "default").trim() || "default";
    const days = Math.max(1, Math.min(365, parseIntSafe(url.searchParams.get("days"), 30)));
    const limit = Math.max(10, Math.min(2000, parseIntSafe(url.searchParams.get("limit"), 500)));

    const stats = await listTagGovernanceFeedbackStats({
      objectiveId,
      days,
      limit,
    });

    return jsonResponse(
      200,
      {
        ok: true,
        generated_at: new Date().toISOString(),
        objective_id: objectiveId,
        days,
        limit,
        stat_count: stats.length,
        stats,
      },
      true,
    );
  } catch (error) {
    return jsonResponse(500, { ok: false, error: error instanceof Error ? error.message : String(error) }, true);
  }
}

export async function POST(request: Request): Promise<Response> {
  const unauthorized = requireArticleDbAuth(request);
  if (unauthorized) {
    return jsonResponse(401, { ok: false, error: unauthorized }, true);
  }

  try {
    const body = await parseBody(request);
    const defaultObjectiveId = String(body.objective_id || "default").trim() || "default";
    const events: FeedbackEventBody[] = Array.isArray(body.events) ? body.events : body.event ? [body.event] : [];

    if (!events.length) {
      return jsonResponse(400, { ok: false, error: "Missing feedback events" }, true);
    }

    const rows = [];
    for (const event of events) {
      const eventType = String(event.event_type || "").trim();
      if (!eventType) {
        continue;
      }
      const row = await appendTagGovernanceFeedback({
        objectiveId: String(event.objective_id || defaultObjectiveId).trim() || defaultObjectiveId,
        eventType,
        groupKey: String(event.group_key || "").trim(),
        tagKey: String(event.tag_key || "").trim(),
        score: Number(event.score ?? 0),
        weight: Number(event.weight ?? 1),
        source: String(event.source || "unknown").trim() || "unknown",
        contextJson: event.context && typeof event.context === "object" ? event.context : {},
      });
      rows.push(row);
    }

    if (!rows.length) {
      return jsonResponse(400, { ok: false, error: "No valid feedback event found" }, true);
    }

    return jsonResponse(
      200,
      {
        ok: true,
        generated_at: new Date().toISOString(),
        inserted_count: rows.length,
        events: rows,
      },
      true,
    );
  } catch (error) {
    return jsonResponse(400, { ok: false, error: error instanceof Error ? error.message : String(error) }, true);
  }
}
