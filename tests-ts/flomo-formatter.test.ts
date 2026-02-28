import { afterEach, describe, expect, it } from "vitest";
import { DailyDigest, WORTH_MUST_READ } from "@/lib/domain/models";
import { buildFlomoPayload, renderFlomoContent, resolveFlomoHomePageUrl } from "@/lib/output/flomo-formatter";

const originalEnv = { ...process.env };

function sampleDigest(): DailyDigest {
  return {
    date: "2026-03-01",
    timezone: "Asia/Shanghai",
    topSummary: "- 今日有两篇重点更新。",
    highlights: [
      {
        generatedTags: [],
        article: {
          id: "a-1",
          title: "Headline",
          url: "https://example.com/article",
          sourceId: "src-1",
          sourceName: "Source",
          publishedAt: null,
          summaryRaw: "",
          leadParagraph: "一句话总结",
          contentText: "",
          infoUrl: "",
          tags: [],
          primaryType: "other",
          secondaryTypes: [],
          score: 88,
          worth: WORTH_MUST_READ,
          reasonShort: "",
        },
      },
    ],
    dailyTags: ["#TagA", "#TagB"],
    extras: [],
  };
}

afterEach(() => {
  process.env = { ...originalEnv };
});

describe("flomo formatter", () => {
  it("inserts H5 page link before ending tags", () => {
    const digest = sampleDigest();
    const content = renderFlomoContent(digest, 20, undefined, "https://ai-news.example.com");
    const lines = content.trim().split("\n");

    const h5LineIndex = lines.findIndex((line) => line.startsWith("H5 页面："));
    const tagLineIndex = lines.findIndex((line) => line.includes("#TagA"));

    expect(h5LineIndex).toBeGreaterThan(-1);
    expect(tagLineIndex).toBeGreaterThan(-1);
    expect(h5LineIndex).toBeLessThan(tagLineIndex);
  });

  it("resolves home page URL from environment and adds it to payload", () => {
    process.env.FLOMO_H5_URL = "https://ai-news.example.com";
    const digest = sampleDigest();

    expect(resolveFlomoHomePageUrl()).toBe("https://ai-news.example.com/");

    const payload = buildFlomoPayload(digest);
    expect(payload.content).toContain("H5 页面：https://ai-news.example.com/");
    expect(payload.content).toContain("#TagA #TagB");
  });
});
