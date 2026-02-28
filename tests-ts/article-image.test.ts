import { beforeEach, describe, expect, it, vi } from "vitest";
import { clearArticleImageCache, extractFirstImageUrlFromHtml, resolveFirstImageUrl } from "@/lib/domain/article-image";

describe("article image", () => {
  beforeEach(() => {
    clearArticleImageCache();
  });

  it("extractFirstImageUrlFromHtml prefers og:image", () => {
    const html = [
      "<html><head>",
      '<meta property="og:image" content="/cover.jpg">',
      '<meta name="twitter:image" content="/tw.jpg">',
      "</head><body></body></html>",
    ].join("");

    const image = extractFirstImageUrlFromHtml(html, "https://example.com/post");
    expect(image).toBe("https://example.com/cover.jpg");
  });

  it("extractFirstImageUrlFromHtml falls back to twitter:image and then first img", () => {
    const twitterHtml = '<meta name="twitter:image" content="https://img.example.com/tw.png">';
    const imgHtml = '<div><img src="/first.png"><img src="/second.png"></div>';

    expect(extractFirstImageUrlFromHtml(twitterHtml, "https://example.com/a")).toBe("https://img.example.com/tw.png");
    expect(extractFirstImageUrlFromHtml(imgHtml, "https://example.com/a")).toBe("https://example.com/first.png");
  });

  it("resolveFirstImageUrl caches result", async () => {
    const fetchImpl = vi.fn(async () => {
      return new Response('<meta property="og:image" content="https://cdn.example.com/cover.webp">', {
        status: 200,
        headers: { "content-type": "text/html" },
      });
    });

    const url = "https://example.com/post";
    const first = await resolveFirstImageUrl(url, { fetchImpl });
    const second = await resolveFirstImageUrl(url, { fetchImpl });

    expect(first).toBe("https://cdn.example.com/cover.webp");
    expect(second).toBe("https://cdn.example.com/cover.webp");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("resolveFirstImageUrl returns empty on fetch failure", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("boom");
    });

    const image = await resolveFirstImageUrl("https://example.com/fail", { fetchImpl });
    expect(image).toBe("");
  });
});
