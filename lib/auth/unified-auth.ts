import { type AccessTokenUser, createRemoteJwksVerifier } from "@stringzhao/auth-sdk";

const DEFAULT_AUTH_ISSUER = "https://user.stringzhao.life";
const DEFAULT_AUTH_AUDIENCE = "base-account-client";
const DEFAULT_AUTH_JWKS_URL = "https://user.stringzhao.life/.well-known/jwks.json";

function envValue(name: string, fallback: string): string {
  const value = String(process.env[name] || "").trim();
  return value || fallback;
}

const verifier = createRemoteJwksVerifier({
  jwksUrl: envValue("AUTH_JWKS_URL", DEFAULT_AUTH_JWKS_URL),
  config: {
    issuer: envValue("AUTH_ISSUER", DEFAULT_AUTH_ISSUER),
    audience: envValue("AUTH_AUDIENCE", DEFAULT_AUTH_AUDIENCE),
  },
});

export type StatsAuthMode = "unified_jwt" | "tracker_token";
export type StatsAuthErrorCode = "missing_access_token" | "invalid_access_token";

export interface StatsAuthSuccess {
  ok: true;
  mode: StatsAuthMode;
  user: AccessTokenUser | null;
}

export interface StatsAuthFailure {
  ok: false;
  error: StatsAuthErrorCode;
}

export type StatsAuthResult = StatsAuthSuccess | StatsAuthFailure;

export function extractBearerToken(headerValue: string | null): string {
  const raw = String(headerValue || "").trim();
  if (!raw) return "";
  const parts = raw.split(" ", 2);
  if (parts.length !== 2) return "";
  const [scheme, token] = parts;
  if (scheme.trim().toLowerCase() !== "bearer") return "";
  return token.trim();
}

export async function verifyUnifiedAccessToken(token: string): Promise<AccessTokenUser> {
  return verifier.verifyAccessToken(token);
}

export async function resolveStatsAuth(request: Request): Promise<StatsAuthResult> {
  const token = extractBearerToken(request.headers.get("authorization"));
  if (!token) {
    return { ok: false, error: "missing_access_token" };
  }

  try {
    const user = await verifyUnifiedAccessToken(token);
    return { ok: true, mode: "unified_jwt", user };
  } catch {
    const trackerApiToken = String(process.env.TRACKER_API_TOKEN || "").trim();
    if (trackerApiToken && token === trackerApiToken) {
      return { ok: true, mode: "tracker_token", user: null };
    }
    return { ok: false, error: "invalid_access_token" };
  }
}
