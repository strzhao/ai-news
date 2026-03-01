import { describe, expect, it } from "vitest";
import { extractRelatedImagesFromHtml, fetchArticleContent } from "@/lib/fetch/article-content-fetcher";

describe("article content fetcher", () => {
  it("extractRelatedImagesFromHtml keeps meta + article images and normalizes relative urls", () => {
    const html = [
      "<html><head>",
      '<meta property="og:image" content="/cover.jpg">',
      "</head><body>",
      "<article>",
      '<img src="/a.png" alt="A image">',
      '<img data-src="https://img.example.com/b.webp" alt="B image">',
      '<img src="data:image/png;base64,abc123">',
      "</article>",
      "</body></html>",
    ].join("");

    const images = extractRelatedImagesFromHtml(html, html, "https://example.com/post", 10);
    expect(images.map((item) => item.url)).toEqual([
      "https://example.com/cover.jpg",
      "https://example.com/a.png",
      "https://img.example.com/b.webp",
    ]);
    expect(images[1]?.alt).toBe("A image");
  });

  it("fetchArticleContent extracts text and images from html", async () => {
    const html = [
      "<html><head>",
      '<meta name="twitter:image" content="https://cdn.example.com/meta.png">',
      "</head><body>",
      "<article>",
      "<h1>Hello</h1>",
      "<p>World</p>",
      '<img src="/inline.jpg" alt="inline">',
      "</article>",
      "</body></html>",
    ].join("");

    const fetchImpl: typeof fetch = async () =>
      new Response(html, {
        status: 200,
        headers: {
          "content-type": "text/html; charset=utf-8",
        },
      });

    const result = await fetchArticleContent("https://example.com/a", {
      fetchImpl,
      timeoutMs: 1000,
      maxImages: 5,
    });

    expect(result.resolvedUrl).toBe("https://example.com/a");
    expect(result.text).toContain("Hello");
    expect(result.text).toContain("World");
    expect(result.images.map((item) => item.url)).toEqual([
      "https://cdn.example.com/meta.png",
      "https://example.com/inline.jpg",
    ]);
  });

  it("fetchArticleContent rejects non-html responses", async () => {
    const fetchImpl: typeof fetch = async () =>
      new Response("{}", {
        status: 200,
        headers: {
          "content-type": "application/json",
        },
      });

    await expect(
      fetchArticleContent("https://example.com/api", {
        fetchImpl,
      }),
    ).rejects.toThrow("Unsupported content-type");
  });
});
