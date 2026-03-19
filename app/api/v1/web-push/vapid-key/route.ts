import { jsonResponse } from "@/lib/infra/route-utils";
import { getVapidPublicKey } from "@/lib/integrations/web-push-server";

export const runtime = "nodejs";

export async function GET(): Promise<Response> {
  try {
    return jsonResponse(200, { ok: true, publicKey: getVapidPublicKey() });
  } catch {
    return jsonResponse(500, { ok: false, error: "vapid_not_configured" });
  }
}
