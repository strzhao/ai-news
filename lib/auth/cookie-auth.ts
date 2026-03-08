import { buildAuthCenterUrl, buildForwardHeaders } from "@/lib/auth/auth-shared";

function firstNonEmptyString(...values: unknown[]): string {
  for (const value of values) {
    const normalized = String(value || "").trim();
    if (normalized) return normalized;
  }
  return "";
}

export interface AuthenticatedUser {
  id: string;
  email: string;
}

export async function resolveUserFromRequest(request: Request): Promise<{
  ok: boolean;
  user?: AuthenticatedUser;
  error?: string;
}> {
  try {
    const authMeUrl = buildAuthCenterUrl("/api/auth/me");
    const upstream = await fetch(authMeUrl, {
      method: "GET",
      headers: buildForwardHeaders(request),
      redirect: "manual",
      cache: "no-store",
    });

    if (upstream.status === 401) {
      return { ok: false, error: "unauthorized" };
    }

    if (!upstream.ok) {
      return { ok: false, error: `auth_upstream_error_${upstream.status}` };
    }

    const payload = (await upstream.json()) as Record<string, unknown>;
    const nestedUser =
      payload.user && typeof payload.user === "object" ? (payload.user as Record<string, unknown>) : null;
    const dataUser =
      payload.data && typeof payload.data === "object"
        ? ((payload.data as Record<string, unknown>).user as Record<string, unknown> | undefined) || null
        : null;

    const id = firstNonEmptyString(
      payload.id, payload.user_id, payload.sub,
      nestedUser?.id, nestedUser?.user_id, nestedUser?.sub,
      dataUser?.id, dataUser?.user_id, dataUser?.sub,
    );
    const email = firstNonEmptyString(payload.email, nestedUser?.email, dataUser?.email);

    if (!id || !email) {
      return { ok: false, error: "invalid_user_payload" };
    }

    return { ok: true, user: { id, email } };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "auth_unavailable" };
  }
}
