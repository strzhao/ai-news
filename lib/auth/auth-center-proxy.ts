import {
  buildAuthCenterUrl,
  buildForwardHeaders,
} from "@/lib/auth/auth-shared";
import { jsonResponse } from "@/lib/infra/route-utils";

function getSetCookieValues(headers: Headers): string[] {
  const withGetSetCookie = headers as Headers & {
    getSetCookie?: () => string[];
  };
  if (typeof withGetSetCookie.getSetCookie === "function") {
    return withGetSetCookie.getSetCookie();
  }
  const single = headers.get("set-cookie");
  return single ? [single] : [];
}

export async function proxyAuthCenter(
  request: Request,
  method: "GET" | "POST",
  pathname: string,
): Promise<Response> {
  try {
    const upstream = await fetch(buildAuthCenterUrl(pathname), {
      method,
      headers: buildForwardHeaders(request),
      redirect: "manual",
      cache: "no-store",
    });

    const bodyText = await upstream.text();
    const response = new Response(bodyText, { status: upstream.status });
    response.headers.set(
      "content-type",
      upstream.headers.get("content-type") || "application/json; charset=utf-8",
    );
    response.headers.set("cache-control", "no-store, max-age=0");

    for (const setCookie of getSetCookieValues(upstream.headers)) {
      response.headers.append("set-cookie", setCookie);
    }

    return response;
  } catch (error) {
    return jsonResponse(
      502,
      {
        ok: false,
        error: "auth_upstream_unavailable",
        message: error instanceof Error ? error.message : String(error),
      },
      true,
    );
  }
}
