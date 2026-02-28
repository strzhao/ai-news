import { afterEach, describe, expect, it } from "vitest";
import { fetchArticles } from "@/lib/fetch/rss-fetcher";
import { SourceConfig } from "@/lib/domain/models";

const originalFetch = globalThis.fetch;

function source(id: string, url: string): SourceConfig {
  return {
    id,
    name: id,
    url,
    sourceWeight: 1,
    sourceType: null,
    onlyExternalLinks: false,
  };
}

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("rss fetcher", () => {
  it("continues to next source when one source times out", async () => {
    const rss = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Feed</title>
    <item>
      <title>Fast Article</title>
      <link>https://example.com/fast</link>
      <description>Quick summary.</description>
      <pubDate>Sat, 28 Feb 2026 16:00:00 GMT</pubDate>
    </item>
  </channel>
</rss>`;

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input instanceof URL ? input.toString() : input);
      if (url.includes("slow.example.com")) {
        return await new Promise<Response>((_resolve, reject) => {
          const signal = init?.signal;
          if (signal) {
            if (signal.aborted) {
              reject(new Error("aborted"));
              return;
            }
            signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
          }
        });
      }
      return new Response(rss, {
        status: 200,
        headers: {
          "content-type": "application/rss+xml",
        },
      });
    }) as typeof fetch;

    const startedAt = Date.now();
    const articles = await fetchArticles(
      [source("slow", "https://slow.example.com/rss"), source("fast", "https://fast.example.com/rss")],
      {
        timeoutSeconds: 1,
      },
    );

    expect(articles).toHaveLength(1);
    expect(articles[0].sourceId).toBe("fast");
    expect(articles[0].title).toBe("Fast Article");
    expect(Date.now() - startedAt).toBeLessThan(5_000);
  });
});
