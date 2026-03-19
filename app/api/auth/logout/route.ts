import { NextResponse } from "next/server";
import { proxyAuthCenter } from "@/lib/auth/auth-center-proxy";
import { clearGatewaySessionCookie } from "@/lib/auth/gateway-session";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  // Proxy to auth center to revoke session and clear shared cookies
  const upstream = await proxyAuthCenter(request, "POST", "/api/auth/logout");

  // Also clear the local gateway session cookie
  const response = NextResponse.json({ ok: true }, { status: upstream.status });

  // Forward set-cookie headers from auth center
  const upstreamHeaders = upstream.headers as Headers & {
    getSetCookie?: () => string[];
  };
  const setCookies =
    typeof upstreamHeaders.getSetCookie === "function"
      ? upstreamHeaders.getSetCookie()
      : [];
  for (const cookie of setCookies) {
    response.headers.append("set-cookie", cookie);
  }

  clearGatewaySessionCookie(response);
  return response;
}
