import { NextResponse } from "next/server";

import { readGatewaySessionFromRequest } from "@/lib/auth/gateway-session";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  const session = readGatewaySessionFromRequest(request);
  if (!session) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  return NextResponse.json({
    id: session.userId,
    email: session.email,
    status: "ACTIVE",
  });
}
