# AI News (Consumer Service)

`ai-news` 现在是消费层服务，负责：

- 首页内容展示（`/`）
- 归档聚合接口（`/api/archive_articles`）
- flomo 推送编排（`/api/v1/flomo/push-from-archive-articles`）
- 点击追踪与统计（`/api/r`, `/api/stats/*`）

文章抓取、AI 分析、标签治理与入库能力已拆分到独立仓库：`article-db`。

## API

- `GET /api/archive_articles`
- `GET /api/v1/flomo/push-from-archive-articles`
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

- `10 23 * * *` (UTC) -> `/api/v1/flomo/push-from-archive-articles`

`article-db` 的 ingestion cron（每小时）已迁移到 `article-db` 仓库中维护。
