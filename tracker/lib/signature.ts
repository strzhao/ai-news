import crypto from "node:crypto";

export type SignedParams = {
  u: string;
  sid: string;
  aid: string;
  d: string;
  ch: string;
};

function quotePlus(value: string): string {
  return encodeURIComponent(value).replace(/%20/g, "+");
}

export function canonicalQuery(params: SignedParams): string {
  const entries = Object.entries(params).sort(([a], [b]) => a.localeCompare(b));
  return entries
    .map(([key, value]) => `${quotePlus(key)}=${quotePlus(value)}`)
    .join("&");
}

export function signParams(params: SignedParams, secret: string): string {
  return crypto
    .createHmac("sha256", secret)
    .update(canonicalQuery(params), "utf8")
    .digest("hex");
}

export function verifySignature(params: SignedParams, providedSig: string, secret: string): boolean {
  if (!providedSig || providedSig.length !== 64) {
    return false;
  }
  const expected = signParams(params, secret);
  try {
    return crypto.timingSafeEqual(Buffer.from(expected, "utf8"), Buffer.from(providedSig, "utf8"));
  } catch {
    return false;
  }
}

export function hashInfoKey(url: string): string {
  return crypto.createHash("sha256").update(url, "utf8").digest("hex").slice(0, 24);
}
