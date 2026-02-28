import { afterEach, describe, expect, it } from "vitest";

import {
  executeArchiveAnalysisCommand,
  executeArchiveItemCommand,
  executeArchiveListCommand,
} from "../src/commands/archive";
import { createTestServer, sendJson, type TestServer } from "./http_server";

let server: TestServer | null = null;

afterEach(async () => {
  if (server) {
    await server.close();
    server = null;
  }
});

describe("archive commands", () => {
  it("loads archive list and computes summary", async () => {
    server = await createTestServer((req, res) => {
      expect(req.url).toContain("/api/archive?days=7&limit_per_day=2");
      sendJson(res, 200, {
        ok: true,
        days: 7,
        limit_per_day: 2,
        groups: [
          {
            date: "2026-02-28",
            items: [
              {
                digest_id: "d1",
                generated_at: "2026-02-28T08:00:00+08:00",
                highlight_count: 7,
              },
            ],
          },
          {
            date: "2026-02-27",
            items: [
              {
                digest_id: "d2",
                generated_at: "2026-02-27T08:00:00+08:00",
                highlight_count: 5,
              },
              {
                digest_id: "d3",
                generated_at: "2026-02-27T12:00:00+08:00",
                highlight_count: 4,
              },
            ],
          },
        ],
      });
    });

    const result = await executeArchiveListCommand({
      baseUrl: server.baseUrl,
      days: 7,
      limitPerDay: 2,
    });
    const payload = result.payload as Record<string, unknown>;
    const summary = payload.summary as Record<string, unknown>;
    expect(summary.group_count).toBe(2);
    expect(summary.item_count).toBe(3);
  });

  it("returns raw markdown for archive item", async () => {
    server = await createTestServer((req, res) => {
      expect(req.url).toContain("/api/archive_item?id=digest-raw");
      sendJson(res, 200, {
        ok: true,
        item: {
          digest_id: "digest-raw",
          markdown: "## hello",
        },
      });
    });

    const result = await executeArchiveItemCommand({
      baseUrl: server.baseUrl,
      id: "digest-raw",
      rawMarkdown: true,
    });
    expect(result.rawText).toBe("## hello");
  });

  it("returns raw markdown for archive analysis", async () => {
    server = await createTestServer((req, res) => {
      expect(req.url).toContain("/api/archive_analysis?id=digest-analysis");
      sendJson(res, 200, {
        ok: true,
        item: {
          digest_id: "digest-analysis",
          analysis_markdown: "## analysis",
        },
      });
    });

    const result = await executeArchiveAnalysisCommand({
      baseUrl: server.baseUrl,
      id: "digest-analysis",
      rawMarkdown: true,
    });
    expect(result.rawText).toBe("## analysis");
  });
});
