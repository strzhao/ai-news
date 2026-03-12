import { NextResponse } from "next/server";
import { readGatewaySessionFromRequest } from "@/lib/auth/gateway-session";

export const runtime = "nodejs";

function readCookie(request: Request, name: string): string {
  const raw = String(request.headers.get("cookie") || "").trim();
  if (!raw) return "";

  for (const chunk of raw.split(";")) {
    const [cookieName, ...valueParts] = chunk.split("=");
    if (String(cookieName || "").trim() !== name) continue;

    const value = valueParts.join("=").trim();
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  }
  return "";
}

export async function POST(request: Request) {
  const session = readGatewaySessionFromRequest(request);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const accessToken = readCookie(request, "access_token");
  if (!accessToken) {
    return NextResponse.json({ error: "No access token found" }, { status: 401 });
  }

  return NextResponse.json({
    access_token: accessToken,
    user_id: session.userId,
    email: session.email,
  });
}
