import { proxyAuthCenter } from "@/lib/auth/auth-center-proxy";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  return proxyAuthCenter(request, "GET", "/api/auth/me");
}
