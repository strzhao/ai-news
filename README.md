# AI News (Consumer Service)

`ai-news` 现在是消费层服务，负责：

- 首页内容展示（`/`）
- 归档聚合接口（`/api/archive_articles`）
- flomo 定时推送（`/api/v1/flomo/cron-push`，每天 7:00/19:00）
- flomo 用户配置（`/api/v1/flomo/config`）
- 点击追踪与统计（`/api/r`, `/api/stats/*`）

文章抓取、AI 分析、标签治理与入库能力已拆分到独立仓库：`article-db`。

## API

- `GET /api/archive_articles`
- `GET /api/v1/flomo/cron-push`
- `GET/POST /api/v1/flomo/config`
- `GET /api/v1/flomo/push-log`
- `GET /api/healthz`
- `GET /api/r`
- `GET /api/stats/sources`
- `GET /api/stats/types`
- `GET /api/cron_digest`（已废弃，返回 `410`）

### Unified Auth

- 登录入口统一使用 `GET https://user.stringzhao.life/authorize?return_to=<callback>&state=<opaque_state>`
- 回跳后必须校验 `authorized=1` 与 `state` 一致
- 前端登录态读取：`GET /api/auth/me`（本站代理到账号中心，避免浏览器 CORS）
- 前端退出登录：`POST /api/auth/logout`（本站代理到账号中心，避免浏览器 CORS）
- `GET /api/stats/sources` 与 `GET /api/stats/types` 支持双轨鉴权：
  - 统一登录 JWT（`Authorization: Bearer <access_token>`）
  - 兼容机器调用 token（`Authorization: Bearer <TRACKER_API_TOKEN>`）

## Environment Variables

### Required for production

- `ARTICLE_DB_BASE_URL`：`article-db` 服务地址
- `ARTICLE_DB_API_TOKEN`：调用 `article-db` 的 Bearer Token（如启用鉴权）
- `CRON_SECRET`：保护 cron 触发接口

`ai-news` 不再直接连接 Postgres。生产环境不应再配置 `DATABASE_URL` / `POSTGRES_URL*`；
文章归档、分析、flomo 批次状态等数据库读写统一由 `article-db` 服务负责。

### flomo

- `FLOMO_API_URL`
- `FLOMO_ARCHIVE_DAYS` (default: `30`)
- `FLOMO_ARCHIVE_LIMIT_PER_DAY` (default: `30`)
- `FLOMO_ARCHIVE_ARTICLE_LIMIT_PER_DAY` (default: `30`)

### tracker

- `TRACKER_BASE_URL`
- `TRACKER_SIGNING_SECRET`
- `TRACKER_API_TOKEN`

### unified auth

- `AUTH_ISSUER` (default: `https://user.stringzhao.life`)
- `AUTH_AUDIENCE` (default: `base-account-client`)
- `AUTH_JWKS_URL` (default: `https://user.stringzhao.life/.well-known/jwks.json`)
- `NEXT_PUBLIC_AUTH_ISSUER` (default: `https://user.stringzhao.life`)
- `NEXT_PUBLIC_AUTH_AUTHORIZE_PATH` (default: `/authorize`)
- `NEXT_PUBLIC_AUTH_CALLBACK_PATH` (default: `/auth/callback`)
- `NEXT_PUBLIC_AUTH_ME_PATH` (default: `/api/auth/me`)
- `NEXT_PUBLIC_AUTH_LOGOUT_PATH` (default: `/api/auth/logout`)

## Development

```bash
npm install
npm run dev
npm run typecheck
npm test
```

## Deployment

`vercel.json` 仅保留消费层 cron：

- `0 23 * * *` (UTC, 北京 07:00) -> `/api/v1/flomo/cron-push`
- `0 11 * * *` (UTC, 北京 19:00) -> `/api/v1/flomo/cron-push`

`article-db` 的 ingestion cron（每小时）已迁移到 `article-db` 仓库中维护。

切换到独立库时：

1. 先在 `article-db` 项目完成新库迁移与验证
2. 保持 `ai-news` 的 `ARTICLE_DB_BASE_URL` 指向 `article-db` 正式域名
3. 删除 `ai-news` 项目中的旧 `DATABASE_URL` / `POSTGRES_URL*`
