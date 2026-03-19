import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import jsYaml from "js-yaml";
import { describe, expect, it } from "vitest";

const ciYaml = readFileSync(
  resolve(__dirname, "../.github/workflows/ci.yml"),
  "utf-8",
);
const ci = jsYaml.load(ciYaml) as Record<string, any>;

describe("CI workflow", () => {
  it("should trigger on push to main and PRs to main", () => {
    expect(ci.on.push.branches).toContain("main");
    expect(ci.on.pull_request.branches).toContain("main");
  });

  it("should have all four quality gate jobs", () => {
    const jobNames = Object.keys(ci.jobs);
    expect(jobNames).toContain("typecheck");
    expect(jobNames).toContain("lint");
    expect(jobNames).toContain("test");
    expect(jobNames).toContain("build");
  });

  it("should use Node.js 22", () => {
    for (const job of Object.values(ci.jobs) as Array<{
      steps: Array<{ with?: { "node-version"?: number } }>;
    }>) {
      const setupNode = job.steps.find(
        (s) => s.with?.["node-version"] !== undefined,
      );
      if (setupNode) {
        expect(setupNode.with?.["node-version"]).toBe(22);
      }
    }
  });

  it("should use npm cache for faster installs", () => {
    for (const job of Object.values(ci.jobs) as Array<{
      steps: Array<{ with?: { cache?: string } }>;
    }>) {
      const setupNode = job.steps.find((s) => s.with?.cache !== undefined);
      expect(setupNode?.with?.cache).toBe("npm");
    }
  });

  it("should have concurrency control to cancel stale runs", () => {
    expect(ci.concurrency).toBeDefined();
    expect(ci.concurrency["cancel-in-progress"]).toBe(true);
  });

  it("build job should have stub env vars for Next.js", () => {
    const buildEnv = ci.jobs.build.env;
    expect(buildEnv).toBeDefined();
    expect(buildEnv.ARTICLE_DB_BASE_URL).toBeDefined();
    expect(buildEnv.AUTH_ISSUER).toBeDefined();
  });
});
