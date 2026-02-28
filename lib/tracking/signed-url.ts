import { signParams } from "@/lib/domain/tracker-common";

export function buildSignedTrackingUrl(baseUrl: string, params: Record<string, string>, secret: string): string {
  const target = new URL("/api/r", baseUrl);
  Object.entries(params).forEach(([key, value]) => {
    if (String(value || "").trim()) {
      target.searchParams.set(key, value);
    }
  });
  target.searchParams.set("sig", signParams(params, secret));
  return target.toString();
}
