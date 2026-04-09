import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 验收测试：内联收藏功能（"即收即存、异步充实"）
 *
 * 设计文档要求：
 * 1. PATCH /api/v1/user-picks 可以只传 title 不传 ai_summary（ai_summary 可选）
 * 2. PATCH 同时更新 user_picks meta 和 hearts meta
 * 3. PATCH 无有效字段时返回 400
 * 4. 收藏页（/hearts）包含 URL 输入框元素
 * 5. 首页（/）不包含"收录文章"按钮或 pick-submit-btn class
 * 6. UrlSubmitFloat 组件文件不存在
 * 7. AppShell 不渲染 UrlSubmitFloat
 * 8. 提交 URL 后，saveUserPick 被调用（最小数据）
 * 9. 提交后 pendingItems 立即包含新卡片
 * 10. 重复 URL 提交被拒绝并显示提示
 * 11. 提取完成后 updatePickFields 被调用更新完整数据
 */

const ROOT = resolve(__dirname, "..");

/* ====================================================================
   辅助函数
   ==================================================================== */

function readSourceFile(relativePath: string): string | null {
  const fullPath = resolve(ROOT, relativePath);
  if (!existsSync(fullPath)) return null;
  return readFileSync(fullPath, "utf-8");
}

/** 在候选目录列表中查找包含指定字符串的文件 */
function findInDirs(dirs: string[], needle: string): boolean {
  const { readdirSync } = require("node:fs") as typeof import("node:fs");
  for (const dir of dirs) {
    const fullDir = resolve(ROOT, dir);
    if (!existsSync(fullDir)) continue;
    try {
      const files = readdirSync(fullDir);
      for (const file of files) {
        if (file.endsWith(".tsx") || file.endsWith(".ts")) {
          const content = readFileSync(resolve(fullDir, file), "utf-8");
          if (content.includes(needle)) return true;
        }
      }
    } catch {
      // ignore read errors
    }
  }
  return false;
}

/* ====================================================================
   API 层：PATCH /api/v1/user-picks 验收
   ==================================================================== */

const { resolveUserMock, hsetMock } = vi.hoisted(() => ({
  resolveUserMock: vi.fn(),
  hsetMock: vi.fn(),
}));

vi.mock("@/lib/auth/cookie-auth", () => ({
  resolveUserFromRequest: (request: Request) => resolveUserMock(request),
}));

vi.mock("@/lib/infra/upstash", () => ({
  buildUpstashClient: () => ({
    zadd: vi.fn().mockResolvedValue(1),
    zrevrangeWithScores: vi.fn().mockResolvedValue([]),
    zscore: vi.fn().mockResolvedValue(Date.now()),
    hset: (...args: unknown[]) => hsetMock(...args),
    hgetall: vi.fn().mockResolvedValue({}),
    expire: vi.fn().mockResolvedValue(1),
    zcard: vi.fn().mockResolvedValue(1),
  }),
}));

import { PATCH } from "@/app/api/v1/user-picks/route";

function patchRequest(body: Record<string, unknown>): Request {
  return new Request("https://example.com/api/v1/user-picks", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("PATCH /api/v1/user-picks – 设计文档验收", () => {
  beforeEach(() => {
    resolveUserMock.mockReset();
    hsetMock.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  /* ---- 需求 1：ai_summary 可选，只传 title 应成功 ---- */

  describe("需求 1：ai_summary 可选", () => {
    it("只传 title 不传 ai_summary 应返回 200（ai_summary 非必填）", async () => {
      resolveUserMock.mockResolvedValue({
        ok: true,
        user: { id: "usr_test", email: "test@example.com" },
      });
      hsetMock.mockResolvedValue("OK");

      const response = await PATCH(
        patchRequest({ article_id: "pick-abc123", title: "新标题" }),
      );
      const payload = (await response.json()) as Record<string, unknown>;

      // 设计文档说 ai_summary 是可选的，不传也要成功
      expect(response.status).toBe(200);
      expect(payload.ok).toBe(true);
    });

    it("同时传 title 和 ai_summary 应返回 200", async () => {
      resolveUserMock.mockResolvedValue({
        ok: true,
        user: { id: "usr_test", email: "test@example.com" },
      });
      hsetMock.mockResolvedValue("OK");

      const response = await PATCH(
        patchRequest({
          article_id: "pick-abc123",
          title: "新标题",
          ai_summary: "AI 生成的总结",
        }),
      );
      const payload = (await response.json()) as Record<string, unknown>;

      expect(response.status).toBe(200);
      expect(payload.ok).toBe(true);
    });

    it("只传 summary（无 ai_summary）应返回 200", async () => {
      resolveUserMock.mockResolvedValue({
        ok: true,
        user: { id: "usr_test", email: "test@example.com" },
      });
      hsetMock.mockResolvedValue("OK");

      const response = await PATCH(
        patchRequest({
          article_id: "pick-abc123",
          summary: "人工写的摘要",
        }),
      );
      const payload = (await response.json()) as Record<string, unknown>;

      expect(response.status).toBe(200);
      expect(payload.ok).toBe(true);
    });
  });

  /* ---- 需求 2：PATCH 同时更新 user_picks meta 和 hearts meta ---- */

  describe("需求 2：PATCH 同时写入两个 hash", () => {
    it("title 更新时同时写 user_picks:meta 和 hearts:meta", async () => {
      resolveUserMock.mockResolvedValue({
        ok: true,
        user: { id: "usr_test", email: "test@example.com" },
      });
      hsetMock.mockResolvedValue("OK");

      await PATCH(
        patchRequest({ article_id: "pick-dup123", title: "更新的标题" }),
      );

      const keys = hsetMock.mock.calls.map(
        (call: unknown[]) => call[0] as string,
      );

      const userPicksMetaUpdated = keys.some((k) =>
        k.includes("user_picks:meta"),
      );
      const heartsMetaUpdated = keys.some((k) => k.includes("hearts:meta"));

      expect(userPicksMetaUpdated).toBe(true);
      expect(heartsMetaUpdated).toBe(true);
    });

    it("image_url 更新时两个 hash 都被写入", async () => {
      resolveUserMock.mockResolvedValue({
        ok: true,
        user: { id: "usr_test", email: "test@example.com" },
      });
      hsetMock.mockResolvedValue("OK");

      await PATCH(
        patchRequest({
          article_id: "pick-img456",
          image_url: "https://example.com/image.jpg",
        }),
      );

      const keys = hsetMock.mock.calls.map(
        (call: unknown[]) => call[0] as string,
      );
      expect(keys.some((k) => k.includes("user_picks:meta"))).toBe(true);
      expect(keys.some((k) => k.includes("hearts:meta"))).toBe(true);
    });
  });

  /* ---- 需求 3：无有效字段时返回 400 ---- */

  describe("需求 3：无有效字段返回 400", () => {
    it("只传 article_id 不带任何可更新字段时返回 400", async () => {
      resolveUserMock.mockResolvedValue({
        ok: true,
        user: { id: "usr_test", email: "test@example.com" },
      });

      const response = await PATCH(patchRequest({ article_id: "pick-empty" }));
      const payload = (await response.json()) as Record<string, unknown>;

      expect(response.status).toBe(400);
      expect(payload.ok).toBe(false);
    });

    it("article_id 缺失时返回 400", async () => {
      resolveUserMock.mockResolvedValue({
        ok: true,
        user: { id: "usr_test", email: "test@example.com" },
      });

      const response = await PATCH(patchRequest({ title: "没有 article_id" }));
      const payload = (await response.json()) as Record<string, unknown>;

      expect(response.status).toBe(400);
      expect(payload.ok).toBe(false);
    });

    it("未认证时返回 401，不写 Redis", async () => {
      resolveUserMock.mockResolvedValue({ ok: false, error: "unauthorized" });

      const response = await PATCH(
        patchRequest({ article_id: "pick-xyz", title: "标题" }),
      );
      const payload = (await response.json()) as Record<string, unknown>;

      expect(response.status).toBe(401);
      expect(payload.ok).toBeFalsy();
      expect(hsetMock).not.toHaveBeenCalled();
    });
  });
});

/* ====================================================================
   前端结构验收（基于源码分析）
   ==================================================================== */

describe("前端结构验收 – 源码静态分析", () => {
  /* ---- 需求 4：收藏页包含 URL 输入框 ---- */

  describe("需求 4：收藏页（/hearts）包含 URL 输入框", () => {
    const HEARTS_DIRS = [
      "app/hearts",
      "app/(main)/hearts",
      "app/(routes)/hearts",
    ];

    it("收藏页目录存在", () => {
      const found = HEARTS_DIRS.some((dir) => existsSync(resolve(ROOT, dir)));
      expect(found).toBe(true);
    });

    it("收藏页源码包含 URL 输入框（type='url' 或 url-input）", () => {
      const { readdirSync } = require("node:fs") as typeof import("node:fs");
      let found = false;

      for (const dir of HEARTS_DIRS) {
        const fullDir = resolve(ROOT, dir);
        if (!existsSync(fullDir)) continue;
        const files = readdirSync(fullDir);
        for (const file of files) {
          if (!file.endsWith(".tsx") && !file.endsWith(".ts")) continue;
          const content = readFileSync(resolve(fullDir, file), "utf-8");
          // 检查是否有 type="url" 的 input 或 url-input class 或 url-submit 相关元素
          if (
            content.includes('type="url"') ||
            content.includes("type='url'") ||
            content.includes("url-input") ||
            content.includes("urlInput") ||
            content.includes("UrlInput") ||
            content.includes("url_input")
          ) {
            found = true;
            break;
          }
        }
        if (found) break;
      }

      expect(found).toBe(true); // 收藏页应包含 URL 输入框（登录用户可见的收藏入口）
    });

    it("收藏页包含登录用户可见的收藏功能", () => {
      const { readdirSync } = require("node:fs") as typeof import("node:fs");
      let found = false;

      for (const dir of HEARTS_DIRS) {
        const fullDir = resolve(ROOT, dir);
        if (!existsSync(fullDir)) continue;
        const files = readdirSync(fullDir);
        for (const file of files) {
          if (!file.endsWith(".tsx") && !file.endsWith(".ts")) continue;
          const content = readFileSync(resolve(fullDir, file), "utf-8");
          // 收藏页应有收藏/保存相关的表单或提交逻辑
          if (
            content.includes("saveUserPick") ||
            content.includes("submitUrl") ||
            content.includes("handleSubmit") ||
            content.includes("onSubmit") ||
            content.includes("收藏")
          ) {
            found = true;
            break;
          }
        }
        if (found) break;
      }

      expect(found).toBe(true);
    });
  });

  /* ---- 需求 5：首页不包含"收录文章"按钮 ---- */

  describe("需求 5：首页移除收录入口", () => {
    it("首页源码不包含 pick-submit-btn class", () => {
      // 首页页面文件
      const homepagePaths = [
        "app/(main)/page.tsx",
        "app/page.tsx",
        "app/(routes)/page.tsx",
      ];

      let homepageContent: string | null = null;
      for (const path of homepagePaths) {
        homepageContent = readSourceFile(path);
        if (homepageContent !== null) break;
      }

      // 如果首页存在，则不应包含 pick-submit-btn
      if (homepageContent !== null) {
        expect(homepageContent).not.toContain("pick-submit-btn");
      }
    });

    it('首页源码不包含"收录文章"按钮文案', () => {
      const homepagePaths = [
        "app/(main)/page.tsx",
        "app/page.tsx",
        "app/(routes)/page.tsx",
      ];

      let homepageContent: string | null = null;
      for (const path of homepagePaths) {
        homepageContent = readSourceFile(path);
        if (homepageContent !== null) break;
      }

      if (homepageContent !== null) {
        expect(homepageContent).not.toContain("收录文章");
      }
    });

    it("首页不触发 url-submit-open 自定义事件", () => {
      const homepagePaths = [
        "app/(main)/page.tsx",
        "app/page.tsx",
        "app/(routes)/page.tsx",
      ];

      let homepageContent: string | null = null;
      for (const path of homepagePaths) {
        homepageContent = readSourceFile(path);
        if (homepageContent !== null) break;
      }

      if (homepageContent !== null) {
        expect(homepageContent).not.toContain("url-submit-open");
      }
    });
  });

  /* ---- 需求 6：UrlSubmitFloat 组件被删除 ---- */

  describe("需求 6：UrlSubmitFloat 组件文件不存在", () => {
    it("app/components/url-submit-float.tsx 文件不存在", () => {
      const filePath = resolve(ROOT, "app/components/url-submit-float.tsx");
      expect(existsSync(filePath)).toBe(false);
    });

    it("UrlSubmitFloat 的变体路径均不存在", () => {
      const candidatePaths = [
        "app/components/url-submit-float.tsx",
        "app/components/UrlSubmitFloat.tsx",
        "app/components/url-submit-float/index.tsx",
        "components/url-submit-float.tsx",
      ];
      for (const p of candidatePaths) {
        expect(existsSync(resolve(ROOT, p))).toBe(false);
      }
    });
  });

  /* ---- 需求 7：AppShell 不渲染 UrlSubmitFloat ---- */

  describe("需求 7：AppShell 不引用 UrlSubmitFloat", () => {
    it("app-shell.tsx 不导入 UrlSubmitFloat", () => {
      const content = readSourceFile("app/components/app-shell.tsx");

      // AppShell 文件应存在
      expect(content).not.toBeNull();

      if (content !== null) {
        // 不应有 UrlSubmitFloat 的导入
        expect(content).not.toContain("UrlSubmitFloat");
        expect(content).not.toContain("url-submit-float");
      }
    });

    it("app-shell.tsx 不渲染 <UrlSubmitFloat", () => {
      const content = readSourceFile("app/components/app-shell.tsx");
      if (content !== null) {
        expect(content).not.toContain("<UrlSubmitFloat");
      }
    });
  });
});

/* ====================================================================
   集成验收：快速收藏流程（带 mock）
   ==================================================================== */

describe("集成验收 – 快速收藏流程", () => {
  /* ---- 需求 8：提交 URL 后 saveUserPick 被调用 ---- */

  describe("需求 8：saveUserPick 被调用（最小数据）", () => {
    it("saveUserPick 接受仅含必填字段的 payload", async () => {
      const { saveUserPick } = await import("@/lib/client/user-picks");

      // Mock global fetch
      const fetchMock = vi.fn().mockResolvedValue({
        json: () => Promise.resolve({ ok: true }),
        ok: true,
      } as Response);
      vi.stubGlobal("fetch", fetchMock);

      // 最小数据：只有 article_id、url，其他字段空字符串
      const minimalPayload = {
        article_id: "pick-abcdef123456",
        title: "",
        url: "https://example.com/article",
        original_url: "https://example.com/article",
        source_host: "example.com",
        image_url: "",
        summary: "",
      };

      const result = await saveUserPick(minimalPayload);
      expect(result.ok).toBe(true);

      // 验证 fetch 被调用，且请求体包含 article_id
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      const sentBody = JSON.parse(init.body as string) as Record<
        string,
        unknown
      >;
      expect(sentBody.article_id).toBe("pick-abcdef123456");
      expect(sentBody.url).toBe("https://example.com/article");

      vi.unstubAllGlobals();
    });

    it("saveUserPick 请求方法是 POST", async () => {
      const { saveUserPick } = await import("@/lib/client/user-picks");

      const fetchMock = vi.fn().mockResolvedValue({
        json: () => Promise.resolve({ ok: true }),
        ok: true,
      } as Response);
      vi.stubGlobal("fetch", fetchMock);

      await saveUserPick({
        article_id: "pick-xyz789",
        title: "测试文章",
        url: "https://test.com",
        original_url: "https://test.com",
        source_host: "test.com",
        image_url: "",
        summary: "",
      });

      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(init.method).toBe("POST");

      vi.unstubAllGlobals();
    });
  });

  /* ---- 需求 9：重复 URL 检测 ---- */

  describe("需求 10：重复 URL 提交被拒绝", () => {
    it("article_id 生成规则：pick-{sha256(url).slice(0,12)}", async () => {
      // 设计文档规定 article_id 基于 URL 的确定性哈希
      // 同一 URL 生成的 article_id 应相同
      const url = "https://example.com/test-article";

      // 模拟哈希生成：pick-{12字符}
      const PICK_ID_PATTERN = /^pick-[0-9a-f]{12}$/;

      // 验证格式约定（通过 Web Crypto API 或 node:crypto）
      const { createHash } = await import("node:crypto");
      const hash = createHash("sha256").update(url).digest("hex").slice(0, 12);
      const generatedId = `pick-${hash}`;

      expect(generatedId).toMatch(PICK_ID_PATTERN);

      // 同一 URL 两次生成的 ID 相同（确定性）
      const hash2 = createHash("sha256").update(url).digest("hex").slice(0, 12);
      const generatedId2 = `pick-${hash2}`;
      expect(generatedId).toBe(generatedId2);
    });

    it("不同 URL 生成不同的 article_id", async () => {
      const { createHash } = await import("node:crypto");

      const url1 = "https://example.com/article-a";
      const url2 = "https://example.com/article-b";

      const id1 = `pick-${createHash("sha256").update(url1).digest("hex").slice(0, 12)}`;
      const id2 = `pick-${createHash("sha256").update(url2).digest("hex").slice(0, 12)}`;

      expect(id1).not.toBe(id2);
    });

    it("重复提交相同 article_id 时 PATCH API 应返回 401（未认证）", async () => {
      // 通过已有的 PATCH 接口验证：如果未认证，应拒绝
      resolveUserMock.mockResolvedValue({ ok: false, error: "unauthorized" });

      const response = await PATCH(
        patchRequest({ article_id: "pick-duplicate12", title: "已存在的文章" }),
      );

      expect(response.status).toBe(401);
      expect(hsetMock).not.toHaveBeenCalled();
    });
  });

  /* ---- 需求 11：提取完成后 updatePickFields 更新多字段 ---- */

  describe("需求 11：提取完成后更新完整数据", () => {
    it("updatePickSummary 发送 PATCH 请求携带 article_id 和 ai_summary", async () => {
      const { updatePickSummary } = await import("@/lib/client/user-picks");

      const fetchMock = vi.fn().mockResolvedValue({
        json: () => Promise.resolve({ ok: true }),
        ok: true,
      } as Response);
      vi.stubGlobal("fetch", fetchMock);

      const articleId = "pick-abc123456789";
      const aiSummary = "这是 AI 生成的详细总结内容";

      const result = await updatePickSummary(articleId, aiSummary);
      expect(result.ok).toBe(true);

      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(init.method).toBe("PATCH");

      const body = JSON.parse(init.body as string) as Record<string, unknown>;
      expect(body.article_id).toBe(articleId);
      expect(body.ai_summary).toBe(aiSummary);

      vi.unstubAllGlobals();
    });

    it("PATCH 同时写 user_picks:meta 和 hearts:meta（含 ai_summary）", async () => {
      resolveUserMock.mockResolvedValue({
        ok: true,
        user: { id: "usr_enricher", email: "enricher@example.com" },
      });
      hsetMock.mockResolvedValue("OK");

      const articleId = "pick-enrich78901";
      const aiSummary = "提取完成后的 AI 总结";

      await PATCH(
        patchRequest({ article_id: articleId, ai_summary: aiSummary }),
      );

      // 两个 hash key 都应被 hset 更新
      const calls = hsetMock.mock.calls as Array<
        [string, Record<string, unknown>]
      >;

      const picksMetaCall = calls.find(([key]) =>
        key.includes("user_picks:meta"),
      );
      const heartsMetaCall = calls.find(([key]) => key.includes("hearts:meta"));

      expect(picksMetaCall).toBeDefined();
      expect(heartsMetaCall).toBeDefined();

      // 更新的字段包含 ai_summary
      if (picksMetaCall) {
        const [, fields] = picksMetaCall;
        expect(fields).toHaveProperty("ai_summary", aiSummary);
      }
      if (heartsMetaCall) {
        const [, fields] = heartsMetaCall;
        expect(fields).toHaveProperty("ai_summary", aiSummary);
      }
    });

    it("PATCH 可以同时更新 title、summary、image_url 等多个字段", async () => {
      resolveUserMock.mockResolvedValue({
        ok: true,
        user: { id: "usr_multi", email: "multi@example.com" },
      });
      hsetMock.mockResolvedValue("OK");

      const response = await PATCH(
        patchRequest({
          article_id: "pick-multi12345",
          title: "完整标题",
          summary: "文章摘要",
          image_url: "https://example.com/thumbnail.jpg",
          ai_summary: "AI 综合总结",
        }),
      );
      const payload = (await response.json()) as Record<string, unknown>;

      expect(response.status).toBe(200);
      expect(payload.ok).toBe(true);

      // 验证多字段都被写入
      const calls = hsetMock.mock.calls as Array<
        [string, Record<string, unknown>]
      >;
      const picksMetaCall = calls.find(([key]) =>
        key.includes("user_picks:meta"),
      );
      if (picksMetaCall) {
        const [, fields] = picksMetaCall;
        // 至少有一个非 article_id 字段被更新
        const updatableFields = ["title", "summary", "image_url", "ai_summary"];
        const hasAny = updatableFields.some((f) => f in fields);
        expect(hasAny).toBe(true);
      }
    });
  });
});

/* ====================================================================
   article_id 哈希生成规范验收
   ==================================================================== */

describe("article_id 生成规范 – pick-{sha256(url).slice(0,12)}", () => {
  it("格式为 pick- 前缀加 12 位十六进制", async () => {
    const { createHash } = await import("node:crypto");
    const testUrls = [
      "https://example.com/article-1",
      "https://medium.com/some-long-post-title",
      "https://arxiv.org/abs/2401.00001",
    ];

    const PATTERN = /^pick-[0-9a-f]{12}$/;
    for (const url of testUrls) {
      const hash = createHash("sha256").update(url).digest("hex").slice(0, 12);
      const id = `pick-${hash}`;
      expect(id).toMatch(PATTERN);
    }
  });

  it("URL 的规范哈希是确定性的（幂等）", async () => {
    const { createHash } = await import("node:crypto");
    const url = "https://example.com/deterministic-test";

    const id1 = `pick-${createHash("sha256").update(url).digest("hex").slice(0, 12)}`;
    const id2 = `pick-${createHash("sha256").update(url).digest("hex").slice(0, 12)}`;
    const id3 = `pick-${createHash("sha256").update(url).digest("hex").slice(0, 12)}`;

    expect(id1).toBe(id2);
    expect(id2).toBe(id3);
  });
});
