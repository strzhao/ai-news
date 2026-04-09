# Autopilot Doctor 诊断报告

**项目**: ai-news  
**技术栈**: Next.js 15 + TypeScript 5.9 + Vitest + Biome  
**诊断时间**: 2026-04-09  
**工作模式**: 修复模式 (--fix)

---

## 总评

**等级: B　　总分: 71/100**

---

## 维度明细

| # | 维度 | 分数 | 状态 | 关键发现 |
|---|------|------|------|----------|
| 1 | 测试基础设施 | 7/10 | ✅ | L1 ✅ (27 测试文件/vitest) + L2 ⚠️ (~9 route 测试/29 路由) + L3 ❌ (无 E2E) |
| 2 | 类型安全 | 10/10 | ✅ | TypeScript 5.9 strict 模式，tsc --noEmit 可用 |
| 3 | 代码质量与健壮性 | 7/10 | ✅ | Biome lint+format+lint:fix + 3 个自定义 Error class，无 ErrorBoundary |
| 4 | 构建系统 | 8/10 | ✅ | next build/dev/start 完备，有 pg 但消费层无需 migration 工具 |
| 5 | CI/CD Pipeline | 9/10 | ✅ | GitHub Actions 四项质量门 (typecheck+lint+test+build) + PR 检查 |
| 6 | 项目结构 | 8/10 | ✅ | 清晰的 app/lib/config 分层，kebab-case 命名一致 |
| 7 | 文档质量 | 8/10 | ✅ | AGENTS.md 内容丰富 + README 包含 API/环境变量/开发说明 |
| 8 | Git 工作流 | 5/10 | ⚠️ | husky+lint-staged ✅，缺 .env.example、worktree-links、commitlint |
| 9 | 依赖与安全基线 | 7/10 | ✅ | lock 文件 + zod + .gitignore 覆盖 .env，1 个 moderate 漏洞 (next.js) |
| 10 | AI 就绪度 | 7/10 | ✅ | AGENTS.md 丰富 + acceptance 测试模板清晰 + scripts 语义化，缺 API schema/mock 基础设施 |
| 11 | 性能保障 | 1/10 | ❌ | P1/P2/P3 均无覆盖，有前端构建但无任何性能监控 |

> 状态图标：✅ ≥ 7 | ⚠️ 4-6 | ❌ ≤ 3

### 测试金字塔分析（Dim 1 详情）

| 层级 | 状态 | 发现 |
|------|------|------|
| L1: 单元/组件测试 | ✅ | Vitest + vitest.config.ts + 27 测试文件 + test:coverage script |
| L2: API/集成测试 | ⚠️ | ~9 route/acceptance 测试 / 29 API 路由 (~31% 覆盖) |
| L3: E2E 测试 | ❌ | 无 Playwright/Cypress 依赖和测试文件 |

### 性能保障分析（Dim 11 详情）

| 方向 | 状态 | 发现 |
|------|------|------|
| P1: Lighthouse CI | ❌ | 无 @lhci/cli 或 .lighthouseci 配置 |
| P2: Playwright 性能 | ❌ | 无性能测试文件或 page.metrics 使用 |
| P3: Bundle Size | ❌ | 无 size-limit 或 bundlewatch 配置 |

---

## Autopilot 兼容性矩阵

| autopilot 功能 | 状态 | 依赖维度 | 说明 |
|----------------|------|----------|------|
| 红队验收测试 | ✅ | Dim 1 | Vitest 框架可用 |
| Tier 0: 红队 QA | ✅ | Dim 1 | 可生成验收测试 |
| Tier 1: 类型检查 | ✅ | Dim 2 | tsc --noEmit strict |
| Tier 1: Lint 检查 | ✅ | Dim 3 | biome check |
| Tier 1: 单元测试 | ✅ | Dim 1 | vitest run |
| Tier 1: 构建验证 | ✅ | Dim 4 | next build |
| Tier 3: Dev Server | ✅ | Dim 4 | next dev -p 3721 |
| 自动修复 lint | ✅ | Dim 3 | biome check --fix |
| 智能提交 | ✅ | — | 始终可用 |
| Tier 1.5: API 集成验证 | ⚠️ | Dim 1 (L2) | 有部分 route 测试，覆盖率 ~31% |
| Tier 1.5: E2E 冒烟测试 | ❌ | Dim 1 (L3) | 无 Playwright/Cypress |
| 安全审查 | ✅ | Dim 9 | 有 zod + .gitignore 安全基线 |
| 红队契约测试 | ⚠️ | Dim 10 | 无 OpenAPI schema，依赖 README 推断 |
| Worktree 并行开发 | ❌ | Dim 8 | 无 worktree-links，无 .env.example |
| Tier 3.5: 性能保障验证 | ❌ | Dim 11 | 无性能工具 |
| 性能预算断言 | ❌ | Dim 11+5 | CI 无性能检查步骤 |

> ✅ 完全可用 | ⚠️ 降级运行 | ❌ 不可用

---

## Top 3 改进建议

### 1. 添加 E2E 测试 (L3)
- **问题**: 29 个 API 路由 + 前端 UI 无冒烟测试
- **影响**: 解锁 Tier 1.5 E2E 冒烟测试，Dim 1 从 7 → 9
- **解决方案**: 安装 Playwright + 生成 chromium-only 配置 + 首页冒烟测试
- **Quick Fix**: `npm i -D @playwright/test && npx playwright install chromium`
- **预估耗时**: 15 分钟

### 2. 补充 .env.example + worktree-links
- **问题**: worktree 并行开发不可用，新开发者配置环境无参考
- **影响**: 解锁 Worktree 并行开发
- **解决方案**: 从 .env.local 提取 key 生成模板 + 创建 worktree-links
- **Quick Fix**: 已由 --fix 模式自动修复 ✅
- **预估耗时**: 5 分钟

### 3. 添加 Bundle 分析能力
- **问题**: 无任何性能监控手段
- **影响**: 解锁 Tier 3.5 性能保障验证
- **解决方案**: @next/bundle-analyzer + analyze script
- **Quick Fix**: 已由 --fix 模式自动修复 ✅
- **预估耗时**: 5 分钟

---

## 已执行的修复

### Fix 1: .env.example + worktree-links (Dim 8)
- ✅ 生成 `.env.example`（业务 key + 占位符，按功能分组）
- ✅ 生成 `.claude/worktree-links`（软链 .env.local）

### Fix 2: @next/bundle-analyzer (Dim 11)
- ✅ 安装 `@next/bundle-analyzer`
- ✅ 更新 `next.config.ts` 添加 withBundleAnalyzer 包裹
- ✅ 添加 `npm run analyze` script
- ✅ typecheck 通过验证
