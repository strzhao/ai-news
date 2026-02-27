const TRACKING_PREFIXES = ["utm_", "spm", "fbclid", "gclid", "ref"];

export function normalizeUrl(raw: string): string {
  try {
    const parsed = new URL(raw);
    const kept: Array<[string, string]> = [];
    for (const [key, value] of parsed.searchParams.entries()) {
      const lower = key.toLowerCase();
      if (TRACKING_PREFIXES.some((prefix) => lower.startsWith(prefix))) {
        continue;
      }
      kept.push([key, value]);
    }
    kept.sort(([a], [b]) => a.localeCompare(b));
    parsed.search = "";
    for (const [key, value] of kept) {
      parsed.searchParams.append(key, value);
    }
    parsed.hash = "";
    parsed.pathname = parsed.pathname.replace(/\/+$/, "") || "/";
    parsed.hostname = parsed.hostname.toLowerCase();
    parsed.protocol = parsed.protocol.toLowerCase();
    return parsed.toString();
  } catch {
    return raw;
  }
}

