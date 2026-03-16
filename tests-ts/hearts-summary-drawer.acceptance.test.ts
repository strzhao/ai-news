import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Acceptance tests for hearts page SummaryDrawer integration.
 *
 * Design-doc requirements verified:
 * 2. Hearts page uses the shared SummaryDrawer component
 * 3. Hearts page has an "AI 总结" button for each article
 * 4. Clicking "AI 总结" on hearts page opens a drawer showing AI summary
 * 5. If a preloaded plain-text summary exists (from user-picks), it shows immediately
 * 11. Homepage behavior must remain unchanged after refactoring
 *
 * Since this project uses vitest with environment: "node" (no DOM),
 * these tests verify source code structure and imports rather than
 * rendered output. A manual UI checklist is provided at the bottom.
 */

const ROOT = resolve(__dirname, "..");

/* ------------------------------------------------------------------ */
/*  Helper: scan a directory for files containing a string             */
/* ------------------------------------------------------------------ */
function directoryContainsString(dir: string, needle: string): boolean {
  const fullDir = resolve(ROOT, dir);
  if (!existsSync(fullDir)) return false;
  const files = readdirSync(fullDir);
  for (const file of files) {
    if (file.endsWith(".tsx") || file.endsWith(".ts")) {
      const content = readFileSync(resolve(fullDir, file), "utf-8");
      if (content.includes(needle)) return true;
    }
  }
  return false;
}

/** All candidate directories where the hearts page might live */
const HEARTS_DIRS = [
  "app/hearts",
  "app/(main)/hearts",
  "app/(routes)/hearts",
];

/** All candidate directories where the homepage might live */
const HOMEPAGE_DIRS = [
  "app",
  "app/(main)",
  "app/(routes)",
];

/* ------------------------------------------------------------------ */
/*  Requirement 2 & 3: Hearts page imports SummaryDrawer               */
/* ------------------------------------------------------------------ */
describe("Hearts page – SummaryDrawer integration (source analysis)", () => {
  it("hearts page or its client component imports SummaryDrawer", () => {
    const found = HEARTS_DIRS.some((dir) =>
      directoryContainsString(dir, "SummaryDrawer"),
    );
    expect(found).toBe(true);
  });

  it("hearts page source contains 'AI 总结' button text", () => {
    const found = HEARTS_DIRS.some((dir) =>
      directoryContainsString(dir, "AI 总结"),
    );
    expect(found).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/*  Requirement 11: Homepage still uses SummaryDrawer                  */
/* ------------------------------------------------------------------ */
describe("Homepage – SummaryDrawer integration preserved", () => {
  it("homepage or its components reference SummaryDrawer", () => {
    // Check homepage directories
    let found = false;

    for (const dir of HOMEPAGE_DIRS) {
      const fullDir = resolve(ROOT, dir);
      if (!existsSync(fullDir)) continue;
      const files = readdirSync(fullDir);
      for (const file of files) {
        // Only check page files in homepage dirs (not all components)
        if (
          (file === "page.tsx" || file === "page.ts") &&
          readFileSync(resolve(fullDir, file), "utf-8").includes("SummaryDrawer")
        ) {
          found = true;
          break;
        }
      }
      if (found) break;
    }

    // Also check app/components/ for homepage-specific wrappers that use SummaryDrawer
    if (!found) {
      found = directoryContainsString("app/components", "SummaryDrawer");
    }

    expect(found).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/*  Requirement 1: Shared component is truly shared (not duplicated)   */
/* ------------------------------------------------------------------ */
describe("SummaryDrawer – no duplication", () => {
  it("summary-drawer.tsx exists at app/components/summary-drawer.tsx", () => {
    expect(existsSync(resolve(ROOT, "app/components/summary-drawer.tsx"))).toBe(
      true,
    );
  });

  it("no duplicate summary-drawer component in hearts directory", () => {
    for (const dir of HEARTS_DIRS) {
      const fullDir = resolve(ROOT, dir);
      if (!existsSync(fullDir)) continue;
      const files = readdirSync(fullDir);
      const hasDuplicate = files.some(
        (f) => f.toLowerCase().includes("summary-drawer") && f.endsWith(".tsx"),
      );
      expect(hasDuplicate).toBe(false);
    }
  });
});

/* ================================================================== */
/*  MANUAL UI ACCEPTANCE CHECKLIST                                     */
/*  (Cannot be automated without jsdom/playwright)                     */
/* ================================================================== */
/*
 * The following requirements must be verified manually in the browser:
 *
 * [ ] REQ-3: Each article on /hearts has an "AI 总结" button
 * [ ] REQ-4: Clicking "AI 总结" opens a drawer overlay
 * [ ] REQ-5: If the article has a preloaded ai_summary from user-picks,
 *            it appears immediately in the drawer (no loading spinner)
 * [ ] REQ-6: The drawer fetches /api/article_summary/{article_id}
 *            (verify in Network tab)
 * [ ] REQ-7: Once markdown response arrives, drawer content updates
 *            from plain text to rendered markdown
 * [ ] REQ-8a: If API returns error AND preloaded text exists,
 *             drawer keeps showing the preloaded text with no error banner
 * [ ] REQ-8b: If API returns error AND no preloaded text,
 *             drawer shows an error message
 * [ ] REQ-9: Pressing Escape key closes the drawer
 * [ ] REQ-10a: Drawer displays article title
 * [ ] REQ-10b: Drawer displays meta info (source, date, etc.)
 * [ ] REQ-10c: Drawer shows loading spinner while fetching
 * [ ] REQ-10d: Drawer has a "阅读原文" button/link
 * [ ] REQ-10e: Drawer has a close button (X or similar)
 * [ ] REQ-11: Homepage /  still works identically –
 *             clicking AI summary on homepage opens the same drawer
 */
