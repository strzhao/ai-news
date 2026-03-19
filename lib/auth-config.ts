const DEFAULT_AUTH_ISSUER = "https://user.stringzhao.life";
const DEFAULT_AUTH_AUTHORIZE_PATH = "/authorize";
const DEFAULT_AUTH_CALLBACK_PATH = "/auth/callback";
const DEFAULT_APP_ORIGIN = "https://ai-news.stringzhao.life";
const DEFAULT_AUTH_ME_PATH = "/api/auth/me";
const DEFAULT_AUTH_LOGOUT_PATH = "/api/auth/logout";

export const AUTH_STATE_STORAGE_KEY = "auth_state";

export function getAuthIssuer(): string {
  return process.env.NEXT_PUBLIC_AUTH_ISSUER ?? DEFAULT_AUTH_ISSUER;
}

function getAuthorizePath(): string {
  return (
    process.env.NEXT_PUBLIC_AUTH_AUTHORIZE_PATH ?? DEFAULT_AUTH_AUTHORIZE_PATH
  );
}

function getCallbackPath(): string {
  return (
    process.env.NEXT_PUBLIC_AUTH_CALLBACK_PATH ?? DEFAULT_AUTH_CALLBACK_PATH
  );
}

function getAppOrigin(): string {
  return process.env.NEXT_PUBLIC_APP_ORIGIN ?? DEFAULT_APP_ORIGIN;
}

function getAuthMePath(): string {
  return process.env.NEXT_PUBLIC_AUTH_ME_PATH ?? DEFAULT_AUTH_ME_PATH;
}

function getAuthLogoutPath(): string {
  return process.env.NEXT_PUBLIC_AUTH_LOGOUT_PATH ?? DEFAULT_AUTH_LOGOUT_PATH;
}

export function generateAuthState(): string {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function buildAuthorizeUrlForCurrentOrigin(
  state: string,
  prompt?: string,
): string {
  const runtimeOrigin =
    typeof window !== "undefined" && window.location?.origin
      ? window.location.origin
      : getAppOrigin();
  const returnTo = new URL(getCallbackPath(), runtimeOrigin).toString();

  const authorizeUrl = new URL(getAuthorizePath(), getAuthIssuer());
  authorizeUrl.searchParams.set("return_to", returnTo);
  authorizeUrl.searchParams.set("state", state);
  if (prompt === "select_account") {
    authorizeUrl.searchParams.set("prompt", "select_account");
  }

  return authorizeUrl.toString();
}

function toRuntimeAbsoluteUrl(rawPathOrUrl: string): string {
  const value = String(rawPathOrUrl || "").trim();
  if (/^https?:\/\//i.test(value)) {
    return value;
  }
  const runtimeOrigin =
    typeof window !== "undefined" && window.location?.origin
      ? window.location.origin
      : getAppOrigin();
  return new URL(
    value.startsWith("/") ? value : `/${value}`,
    runtimeOrigin,
  ).toString();
}

export function buildAuthMeUrl(): string {
  return toRuntimeAbsoluteUrl(getAuthMePath());
}

export function buildAuthLogoutUrl(): string {
  return toRuntimeAbsoluteUrl(getAuthLogoutPath());
}
