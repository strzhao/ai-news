import { readGatewaySessionFromRequest } from "@/lib/auth/gateway-session";

export interface AuthenticatedUser {
  id: string;
  email: string;
}

export async function resolveUserFromRequest(request: Request): Promise<{
  ok: boolean;
  user?: AuthenticatedUser;
  error?: string;
}> {
  const session = readGatewaySessionFromRequest(request);
  if (session) {
    return { ok: true, user: { id: session.userId, email: session.email } };
  }

  return { ok: false, error: "unauthorized" };
}
