import { proxyAuthCenter } from "@/lib/auth/auth-center-proxy";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  return proxyAuthCenter(request, "POST", "/api/auth/logout");
}
