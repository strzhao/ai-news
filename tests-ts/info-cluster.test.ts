import { describe, expect, it } from "vitest";
import { buildInfoKey, buildTitleKey } from "@/lib/process/info-cluster";

describe("info cluster", () => {
  it("buildInfoKey prefers info_url", () => {
    const key = buildInfoKey({
      id: "a1",
      title: "test title",
      url: "https://source.example.com/post?id=1&utm_source=x",
      infoUrl: "https://ref.example.com/path?ref=abc&id=2",
      sourceId: "source",
      sourceName: "Source",
      publishedAt: null,
      summaryRaw: "",
      leadParagraph: "",
      contentText: "",
      tags: [],
      primaryType: "",
      secondaryTypes: [],
    });
    expect(key).toContain("ref.example.com");
    expect(key).toContain("id=2");
    expect(key).not.toContain("ref=");
  });

  it("buildTitleKey falls back when title exists", () => {
    const key = buildTitleKey("New Model Release!!!");
    expect(key.startsWith("title:")).toBe(true);
  });
});
