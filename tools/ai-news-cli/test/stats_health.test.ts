import { afterEach, describe, expect, it } from "vitest";

import { executeHealthCommand } from "../src/commands/health";
import { executeStatsSourcesCommand, executeStatsTypesCommand } from "../src/commands/stats";
import { createTestServer, sendJson, type TestServer } from "./http_server";

let server: TestServer | null = null;

afterEach(async () => {
  if (server) {
    await server.close();
    server = null;
  }
});

describe("stats and health commands", () => {
  it("reads source stats with tracker token", async () => {
    server = await createTestServer((req, res) => {
      expect(req.headers.authorization).toBe("Bearer tracker-secret");
      sendJson(res, 200, {
        days: 30,
        rows: [
          { date: "2026-02-28", source_id: "s1", clicks: 2 },
          { date: "2026-02-28", source_id: "s2", clicks: 1 },
          { date: "2026-02-27", source_id: "s1", clicks: 3 },
        ],
      });
    });

    const result = await executeStatsSourcesCommand({
      baseUrl: server.baseUrl,
      trackerToken: "tracker-secret",
      days: 30,
    });
    const payload = result.payload as Record<string, unknown>;
    const summary = payload.summary as Record<string, unknown>;
    expect(summary.total_clicks).toBe(6);
  });

  it("maps unauthorized stats request to exit code 3", async () => {
    server = await createTestServer((_req, res) => {
      sendJson(res, 401, { error: "Unauthorized" });
    });

    await expect(
      executeStatsTypesCommand({
        baseUrl: server.baseUrl,
        trackerToken: "bad-token",
      }),
    ).rejects.toMatchObject({
      code: 3,
    });
  });

  it("returns health payload with latency", async () => {
    server = await createTestServer((_req, res) => {
      sendJson(res, 200, { ok: true, now: "2026-02-28T00:00:00Z" });
    });

    const result = await executeHealthCommand({
      baseUrl: server.baseUrl,
    });
    const payload = result.payload as Record<string, unknown>;
    expect(payload.ok).toBe(true);
    expect(typeof payload.latency_ms).toBe("number");
  });
});
