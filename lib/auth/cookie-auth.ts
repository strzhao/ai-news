import { readGatewaySessionFromRequest } from "@/lib/auth/gateway-session";
import {
  extractBearerToken,
  verifyUnifiedAccessToken,
} from "@/lib/auth/unified-auth";

export interface AuthenticatedUser {
  id: string;
  email: string;
}

export async function resolveUserFromRequest(request: Request): Promise<{
  ok: boolean;
  user?: AuthenticatedUser;
  error?: string;
}> {
  // Path 1: Bearer token (CLI / machine calls)
  const bearer = extractBearerToken(request.headers.get("authorization"));
  if (bearer) {
    try {
      const tokenUser = await verifyUnifiedAccessToken(bearer);
      if (tokenUser?.sub && tokenUser?.email) {
        return {
          ok: true,
          user: { id: tokenUser.sub, email: tokenUser.email },
        };
      }
    } catch {
      return { ok: false, error: "invalid_access_token" };
    }
  }

  // Path 2: Gateway session cookie (browser)
  const session = readGatewaySessionFromRequest(request);
  if (session) {
    return { ok: true, user: { id: session.userId, email: session.email } };
  }

  return { ok: false, error: "unauthorized" };
}
