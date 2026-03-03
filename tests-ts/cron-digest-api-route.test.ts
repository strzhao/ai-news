import { describe, expect, it } from "vitest";
import { GET } from "@/app/api/cron_digest/route";

describe("cron_digest route", () => {
  it("returns deprecation payload", async () => {
    const response = await GET();
    const payload = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(410);
    expect(payload.ok).toBe(false);
    expect(payload.replacement).toBe("article-db:/api/v1/ingestion/run");
  });
});
