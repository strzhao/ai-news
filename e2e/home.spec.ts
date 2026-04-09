import { expect, test } from "@playwright/test";

test.describe("首页冒烟测试", () => {
  test("页面可访问，标题包含相关文字", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveTitle(/AI|新闻|日报|News/i);
  });

  test(".newsletter-header 立即可见", async ({ page }) => {
    await page.goto("/");
    const header = page.locator(".newsletter-header");
    await expect(header).toBeVisible();
  });

  test(".newsletter-date 包含日期文字", async ({ page }) => {
    await page.goto("/");
    const dateEl = page.locator(".newsletter-date");
    await expect(dateEl).toBeVisible();
    // 日期应包含年份数字
    await expect(dateEl).toContainText(/\d{4}/);
  });

  test("今日精选 h2 标题可见", async ({ page }) => {
    await page.goto("/");
    const heading = page.locator("h2", { hasText: "今日精选" });
    await expect(heading).toBeVisible();
  });

  test(".newsletter-subtitle 数据加载后不再显示「正在更新」", async ({
    page,
  }) => {
    await page.goto("/");
    const subtitle = page.locator(".newsletter-subtitle");
    await expect(subtitle).toBeVisible();
    // 等待加载完成：subtitle 不再包含"正在更新"
    await expect(subtitle).not.toContainText("正在更新", {
      timeout: 30_000,
    });
  });

  test(".editorial-list 容器在数据加载后可见（或显示空状态）", async ({
    page,
  }) => {
    await page.goto("/");
    // 等待加载完成
    await expect(page.locator(".newsletter-subtitle")).not.toContainText(
      "正在更新",
      { timeout: 30_000 },
    );
    // 列表容器存在
    const editorialList = page.locator(".editorial-list");
    await expect(editorialList).toBeVisible();
    // 容器内有文章卡片或空状态提示
    const hasArticles = await editorialList
      .locator(".article-row")
      .count()
      .then((n) => n > 0);
    const hasEmpty = await editorialList
      .locator(".empty-note")
      .count()
      .then((n) => n > 0);
    expect(hasArticles || hasEmpty).toBe(true);
  });

  test("页面无 JS 运行时异常", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (err) => {
      errors.push(err.message);
    });

    await page.goto("/");
    // 等待数据加载完成再检查
    await expect(page.locator(".newsletter-subtitle")).not.toContainText(
      "正在更新",
      { timeout: 30_000 },
    );

    expect(errors).toHaveLength(0);
  });
});
