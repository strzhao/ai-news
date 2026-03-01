import { requireArticleDbAuth } from "@/lib/article-db/auth";
import { deactivateTagDefinition, upsertTagDefinition } from "@/lib/article-db/repository";
import { jsonResponse } from "@/lib/infra/route-utils";

export const runtime = "nodejs";
export const maxDuration = 300;
export const preferredRegion = ["sin1"];

interface TagBody {
  display_name?: string;
  description?: string;
  aliases?: string[];
  is_active?: boolean;
  managed_by?: string;
}

async function parseBody(request: Request): Promise<TagBody> {
  try {
    const body = (await request.json()) as TagBody;
    if (!body || typeof body !== "object") return {};
    return body;
  } catch {
    return {};
  }
}

export async function PUT(
  request: Request,
  context: { params: Promise<{ group_key: string; tag_key: string }> },
): Promise<Response> {
  const unauthorized = requireArticleDbAuth(request);
  if (unauthorized) {
    return jsonResponse(401, { ok: false, error: unauthorized }, true);
  }

  const params = await context.params;
  const groupKey = String(params.group_key || "").trim();
  const tagKey = String(params.tag_key || "").trim();
  if (!groupKey || !tagKey) {
    return jsonResponse(400, { ok: false, error: "Missing group_key or tag_key" }, true);
  }

  const body = await parseBody(request);

  try {
    await upsertTagDefinition({
      groupKey,
      tagKey,
      displayName: String(body.display_name || tagKey),
      description: String(body.description || ""),
      aliases: Array.isArray(body.aliases) ? body.aliases : [],
      isActive: body.is_active,
      managedBy: String(body.managed_by || "ai_manual"),
    });

    return jsonResponse(
      200,
      {
        ok: true,
        generated_at: new Date().toISOString(),
        group_key: groupKey,
        tag_key: tagKey,
      },
      true,
    );
  } catch (error) {
    return jsonResponse(400, { ok: false, error: error instanceof Error ? error.message : String(error) }, true);
  }
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ group_key: string; tag_key: string }> },
): Promise<Response> {
  const unauthorized = requireArticleDbAuth(request);
  if (unauthorized) {
    return jsonResponse(401, { ok: false, error: unauthorized }, true);
  }

  const params = await context.params;
  const groupKey = String(params.group_key || "").trim();
  const tagKey = String(params.tag_key || "").trim();
  if (!groupKey || !tagKey) {
    return jsonResponse(400, { ok: false, error: "Missing group_key or tag_key" }, true);
  }

  try {
    const existed = await deactivateTagDefinition(groupKey, tagKey);
    if (!existed) {
      return jsonResponse(404, { ok: false, error: "Tag not found" }, true);
    }

    return jsonResponse(
      200,
      {
        ok: true,
        generated_at: new Date().toISOString(),
        group_key: groupKey,
        tag_key: tagKey,
        deactivated: true,
      },
      true,
    );
  } catch (error) {
    return jsonResponse(500, { ok: false, error: error instanceof Error ? error.message : String(error) }, true);
  }
}
