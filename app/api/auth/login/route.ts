import { type NextRequest, NextResponse } from "next/server";

import {
  applyAuthStateCookie,
  createAuthStateCookieValue,
} from "@/lib/auth/gateway-session";

export const runtime = "nodejs";

const DEFAULT_AUTH_ISSUER = "https://user.stringzhao.life";
const DEFAULT_APP_ORIGIN = "https://ai-news.stringzhao.life";

function getAuthIssuer(): string {
  return (
    String(
      process.env.AUTH_ISSUER || process.env.NEXT_PUBLIC_AUTH_ISSUER || "",
    ).trim() || DEFAULT_AUTH_ISSUER
  );
}

function getAppOrigin(): string {
  return (
    String(
      process.env.APP_ORIGIN || process.env.NEXT_PUBLIC_APP_ORIGIN || "",
    ).trim() || DEFAULT_APP_ORIGIN
  );
}

export async function GET(request: NextRequest): Promise<Response> {
  const { searchParams } = request.nextUrl;
  const next = searchParams.get("next") || "/";
  const prompt = searchParams.get("prompt") || undefined;

  const state = crypto.randomUUID();
  const returnTo = new URL("/auth/callback", getAppOrigin()).toString();

  const authorizeUrl = new URL("/authorize", getAuthIssuer());
  authorizeUrl.searchParams.set("return_to", returnTo);
  authorizeUrl.searchParams.set("state", state);
  if (prompt === "select_account") {
    authorizeUrl.searchParams.set("prompt", "select_account");
  }

  const response = NextResponse.redirect(authorizeUrl.toString());
  applyAuthStateCookie(response, createAuthStateCookieValue(state, next));
  return response;
}
