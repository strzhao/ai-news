import { ScoredArticle } from "@/lib/domain/models";
import { buildSignedTrackingUrl } from "@/lib/tracking/signed-url";

function envEnabled(name: string, defaultValue = "false"): boolean {
  const value = String(process.env[name] || defaultValue || "").trim().toLowerCase();
  return !["0", "false", "no", "off"].includes(value);
}

export class LinkTracker {
  constructor(
    public readonly baseUrl = String(process.env.TRACKER_BASE_URL || "").trim().replace(/\/$/, ""),
    public readonly signingSecret = String(process.env.TRACKER_SIGNING_SECRET || "").trim(),
  ) {}

  static fromEnv(): LinkTracker {
    return new LinkTracker();
  }

  enabled(): boolean {
    return Boolean(this.baseUrl && this.signingSecret);
  }

  buildTrackingUrl(article: ScoredArticle, options: { digestDate: string; channel: string }): string {
    const targetUrl = String(article.url || "").trim();
    if (!targetUrl || !this.enabled()) {
      return targetUrl;
    }

    const params: Record<string, string> = {
      u: targetUrl,
      sid: article.sourceId,
      aid: article.id,
      d: options.digestDate,
      ch: options.channel,
    };

    const primaryType = String(article.primaryType || "").trim();
    if (primaryType && envEnabled("TRACKER_INCLUDE_TYPE_PARAM", "false")) {
      params.pt = primaryType;
    }

    return buildSignedTrackingUrl(this.baseUrl, params, this.signingSecret);
  }
}
