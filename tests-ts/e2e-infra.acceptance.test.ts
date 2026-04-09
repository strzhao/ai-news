import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Acceptance tests for Playwright E2E test infrastructure.
 *
 * Design-doc requirements verified:
 * 1. @playwright/test installed in devDependencies
 * 2. playwright.config.ts exists with correct configuration:
 *    - testDir pointing to e2e/
 *    - chromium-only (no firefox/webkit)
 *    - baseURL set to localhost:3721
 *    - webServer uses /api/healthz as readiness probe
 * 3. e2e/tsconfig.json provides type isolation (types does not include vitest/globals)
 * 4. tsconfig.json excludes e2e/ directory
 * 5. package.json has test:e2e script set to "playwright test"
 * 6. .gitignore includes Playwright artifact directories
 * 7. vitest.config.ts is not modified to include e2e/
 * 8. e2e/ directory exists and contains test files
 */

const ROOT = resolve(__dirname, "..");

/* ------------------------------------------------------------------ */
/*  Requirement 1: @playwright/test installed                          */
/* ------------------------------------------------------------------ */
describe("Playwright E2E infra – package installation", () => {
  it("@playwright/test is listed in devDependencies", () => {
    const pkg = JSON.parse(
      readFileSync(resolve(ROOT, "package.json"), "utf-8"),
    );
    expect(pkg.devDependencies).toHaveProperty("@playwright/test");
  });
});

/* ------------------------------------------------------------------ */
/*  Requirement 2: playwright.config.ts exists and is configured      */
/* ------------------------------------------------------------------ */
describe("Playwright E2E infra – playwright.config.ts", () => {
  const configPath = resolve(ROOT, "playwright.config.ts");

  it("playwright.config.ts exists", () => {
    expect(existsSync(configPath)).toBe(true);
  });

  it("testDir points to e2e/", () => {
    const content = readFileSync(configPath, "utf-8");
    // Accept both relative "e2e" / "./e2e" and an absolute path ending with e2e
    expect(content).toMatch(/testDir\s*:\s*["'`][./]*e2e["'`]/);
  });

  it("only includes chromium – no firefox project", () => {
    const content = readFileSync(configPath, "utf-8");
    expect(content).not.toMatch(/firefox/i);
  });

  it("only includes chromium – no webkit project", () => {
    const content = readFileSync(configPath, "utf-8");
    expect(content).not.toMatch(/webkit/i);
  });

  it("baseURL is set to localhost:3721", () => {
    const content = readFileSync(configPath, "utf-8");
    expect(content).toContain("localhost:3721");
  });

  it("webServer uses /api/healthz as readiness probe", () => {
    const content = readFileSync(configPath, "utf-8");
    expect(content).toContain("/api/healthz");
  });
});

/* ------------------------------------------------------------------ */
/*  Requirement 3: e2e/tsconfig.json type isolation                   */
/* ------------------------------------------------------------------ */
describe("Playwright E2E infra – e2e/tsconfig.json type isolation", () => {
  const e2eTsConfigPath = resolve(ROOT, "e2e/tsconfig.json");

  it("e2e/tsconfig.json exists", () => {
    expect(existsSync(e2eTsConfigPath)).toBe(true);
  });

  it("types array does not include vitest/globals", () => {
    const tsconfig = JSON.parse(readFileSync(e2eTsConfigPath, "utf-8"));
    const types: string[] | undefined = tsconfig?.compilerOptions?.types;
    // Either types is absent, empty, or does not contain vitest/globals
    if (types !== undefined) {
      expect(types).not.toContain("vitest/globals");
    }
  });
});

/* ------------------------------------------------------------------ */
/*  Requirement 4: tsconfig.json excludes e2e/                        */
/* ------------------------------------------------------------------ */
describe("Playwright E2E infra – tsconfig.json excludes e2e/", () => {
  it('exclude array in tsconfig.json contains "e2e"', () => {
    const tsconfig = JSON.parse(
      readFileSync(resolve(ROOT, "tsconfig.json"), "utf-8"),
    );
    const exclude: string[] | undefined = tsconfig?.exclude;
    expect(exclude).toBeDefined();
    expect(exclude).toContain("e2e");
  });
});

/* ------------------------------------------------------------------ */
/*  Requirement 5: package.json has test:e2e script                   */
/* ------------------------------------------------------------------ */
describe("Playwright E2E infra – test:e2e script", () => {
  it('package.json scripts.test:e2e equals "playwright test"', () => {
    const pkg = JSON.parse(
      readFileSync(resolve(ROOT, "package.json"), "utf-8"),
    );
    expect(pkg.scripts).toHaveProperty("test:e2e");
    expect(pkg.scripts["test:e2e"]).toBe("playwright test");
  });
});

/* ------------------------------------------------------------------ */
/*  Requirement 6: .gitignore includes Playwright artifact dirs       */
/* ------------------------------------------------------------------ */
describe("Playwright E2E infra – .gitignore", () => {
  const gitignoreContent = readFileSync(resolve(ROOT, ".gitignore"), "utf-8");

  it(".gitignore includes test-results/", () => {
    expect(gitignoreContent).toContain("test-results/");
  });

  it(".gitignore includes playwright-report/", () => {
    expect(gitignoreContent).toContain("playwright-report/");
  });
});

/* ------------------------------------------------------------------ */
/*  Requirement 7: vitest.config.ts is not modified to include e2e/  */
/* ------------------------------------------------------------------ */
describe("Playwright E2E infra – vitest.config.ts isolation", () => {
  it("vitest.config.ts include pattern does not cover e2e/", () => {
    const vitestConfigPath = resolve(ROOT, "vitest.config.ts");
    if (!existsSync(vitestConfigPath)) {
      // If there is no vitest.config.ts, the check passes trivially
      return;
    }
    const content = readFileSync(vitestConfigPath, "utf-8");
    // The include glob must not accidentally pull in e2e/**
    expect(content).not.toMatch(/include\s*:.*e2e/);
  });
});

/* ------------------------------------------------------------------ */
/*  Requirement 8: e2e/ directory exists and has test files           */
/* ------------------------------------------------------------------ */
describe("Playwright E2E infra – e2e/ directory structure", () => {
  it("e2e/ directory exists", () => {
    expect(existsSync(resolve(ROOT, "e2e"))).toBe(true);
  });

  it("e2e/ directory contains at least one spec file (*.spec.ts)", () => {
    const { readdirSync } = require("node:fs");
    const e2eDir = resolve(ROOT, "e2e");
    if (!existsSync(e2eDir)) {
      // Will already fail on the previous test; skip to avoid cascading noise
      return;
    }
    const files: string[] = readdirSync(e2eDir);
    const specFiles = files.filter((f: string) => f.endsWith(".spec.ts"));
    expect(specFiles.length).toBeGreaterThan(0);
  });
});
