import { buildAuthMeUrl } from "@/lib/auth-config";
import type { AuthUser } from "./types";

function firstNonEmptyString(...values: unknown[]): string {
  for (const value of values) {
    const normalized = String(value || "").trim();
    if (normalized) return normalized;
  }
  return "";
}

export function extractAuthUser(payload: Record<string, unknown>): AuthUser | null {
  const nestedUser = payload.user && typeof payload.user === "object" ? (payload.user as Record<string, unknown>) : null;
  const dataUser =
    payload.data && typeof payload.data === "object"
      ? ((payload.data as Record<string, unknown>).user as Record<string, unknown> | undefined) || null
      : null;

  const id = firstNonEmptyString(
    payload.id,
    payload.user_id,
    payload.sub,
    nestedUser?.id,
    nestedUser?.user_id,
    nestedUser?.sub,
    dataUser?.id,
    dataUser?.user_id,
    dataUser?.sub,
  );
  const email = firstNonEmptyString(payload.email, nestedUser?.email, dataUser?.email);
  const status = firstNonEmptyString(payload.status, nestedUser?.status, dataUser?.status, "ACTIVE");

  if (!id || !email) return null;
  return { id, email, status };
}

export async function fetchAuthUser(): Promise<{ user: AuthUser | null; error: string | null }> {
  try {
    const response = await fetch(buildAuthMeUrl(), {
      cache: "no-store",
      credentials: "include",
    });
    if (response.status === 401) {
      return { user: null, error: null };
    }

    const payload = (await response.json()) as Record<string, unknown>;
    if (!response.ok) {
      return { user: null, error: "登录状态读取失败，请稍后重试。" };
    }

    const user = extractAuthUser(payload);
    if (!user) {
      return { user: null, error: "登录状态异常，请重新登录。" };
    }

    return { user, error: null };
  } catch {
    return { user: null, error: "统一账号服务暂不可用，请稍后重试。" };
  }
}
