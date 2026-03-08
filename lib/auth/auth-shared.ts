const DEFAULT_AUTH_ISSUER = "https://user.stringzhao.life";

export function getAuthIssuer(): string {
  const fromEnv = String(process.env.AUTH_ISSUER || process.env.NEXT_PUBLIC_AUTH_ISSUER || "").trim();
  return fromEnv || DEFAULT_AUTH_ISSUER;
}

export function buildAuthCenterUrl(pathname: string): string {
  return new URL(pathname, getAuthIssuer()).toString();
}

export function buildForwardHeaders(request: Request): Headers {
  const headers = new Headers();

  const cookie = request.headers.get("cookie");
  if (cookie) {
    headers.set("cookie", cookie);
  }

  const authorization = request.headers.get("authorization");
  if (authorization) {
    headers.set("authorization", authorization);
  }

  const userAgent = request.headers.get("user-agent");
  if (userAgent) {
    headers.set("user-agent", userAgent);
  }

  headers.set("accept", "application/json");
  return headers;
}
