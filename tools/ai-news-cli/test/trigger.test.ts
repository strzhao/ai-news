import { afterEach, describe, expect, it } from "vitest";

import { executeTriggerCommand } from "../src/commands/trigger";
import { createTestServer, sendJson, type TestServer } from "./http_server";

let server: TestServer | null = null;

afterEach(async () => {
  if (server) {
    await server.close();
    server = null;
  }
});

describe("executeTriggerCommand", () => {
  it("uses Authorization header by default", async () => {
    server = await createTestServer((req, res) => {
      expect(req.url).toBe("/api/cron_digest");
      expect(req.headers.authorization).toBe("Bearer secret-token");
      sendJson(res, 200, {
        ok: true,
        report_date: "2026-02-28",
        digest_id: "digest-1",
        highlight_count: 7,
        elapsed_ms: 1200,
        archive_saved: true,
        analysis_archive_saved: false,
      });
    });

    const result = await executeTriggerCommand({
      baseUrl: server.baseUrl,
      token: "secret-token",
    });

    const payload = result.payload as Record<string, unknown>;
    expect(payload.request_mode).toBe("header");
    expect(payload.ok).toBe(true);
  });

  it("falls back to query token when header auth is rejected", async () => {
    let requests = 0;
    server = await createTestServer((req, res) => {
      requests += 1;
      if (requests === 1) {
        expect(req.headers.authorization).toBe("Bearer secret-token");
        sendJson(res, 401, { ok: false, error: "Unauthorized" });
        return;
      }

      expect(req.url).toContain("/api/cron_digest?token=secret-token");
      sendJson(res, 200, {
        ok: true,
        report_date: "2026-02-28",
        digest_id: "digest-2",
        highlight_count: 3,
      });
    });

    const result = await executeTriggerCommand({
      baseUrl: server.baseUrl,
      token: "secret-token",
    });

    const payload = result.payload as Record<string, unknown>;
    expect(payload.request_mode).toBe("query_fallback");
    expect(requests).toBe(2);
  });

  it("requires --force when ignore-repeat-limit is enabled", async () => {
    await expect(
      executeTriggerCommand({
        baseUrl: "https://example.com",
        ignoreRepeatLimit: true,
      }),
    ).rejects.toMatchObject({
      code: 1,
    });
  });
});
