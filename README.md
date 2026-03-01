# AI News Daily Digest (Next.js)

每天北京时间 07:00 自动抓取优质 AI RSS，使用 DeepSeek 进行「单篇评估 + 汇总编排」生成中文日报（重点文章 + 一句话总结 + 日报技术标签），并可同步到 flomo。当前主实现为 Next.js App Router + Route Handlers。

## Architecture (2026 Upgrade)

- 生产层（Article DB）：
  - `GET /api/v1/ingestion/run`：抓取 + AI 分析 + Postgres 归档（建议部署在 `sin1`）
  - `GET /api/v1/migration/import-legacy`：将旧 Upstash 归档导入 Postgres（一次性迁移用）
  - `GET /api/v1/articles/high-quality`
  - `GET /api/v1/articles/high-quality/range`
  - `GET /api/v1/articles/:article_id`
  - `GET /api/v1/runs/:date`
  - `GET /api/v1/tags/groups`
  - `PUT /api/v1/tags/groups/:group_key/:tag_key`
  - `DELETE /api/v1/tags/groups/:group_key/:tag_key`
- 消费层（AI-news）：
  - `GET /api/archive_articles` 对前端保持兼容，内部优先消费 `ARTICLE_DB_BASE_URL`
- 旧入口 `GET /api/cron_digest` 已废弃，返回 `410`。

## Quick Start

```bash
npm install
npm run dev
```

本地访问：`http://localhost:3000`  
手动触发入库：`GET /api/v1/ingestion/run`（支持 `Authorization: Bearer $CRON_SECRET` 或 `?token=`）

## Environment Variables

### Article DB (Postgres + Internal API)

- `DATABASE_URL` (required for `/api/v1/*` article-db endpoints)
- `ARTICLE_DB_API_TOKEN` (recommended；设置后 `/api/v1/*` 要求 `Authorization: Bearer <token>`)
- `QUALITY_SCORE_THRESHOLD` (default: `62`，仅按综合分决定是否进入高质量归档)
- `INGESTION_DAILY_MERGE_MODE` (default: `true`，同一天重跑时合并快照并按 `(date, article_id)` 去重；设为 `false` 时恢复覆盖模式)
- `ARTICLE_DB_MAX_PER_SOURCE` (default: `25`)
- `HQ_CONTENT_CRAWL_ENABLED` (default: `true`，是否为高质量文章抓取并持久化原文全文 + 相关图片)
- `HQ_CONTENT_CRAWL_LIMIT` (default: `20`，每次 ingestion 最多处理的高质量文章数；`0` 表示不限制)
- `HQ_CONTENT_CRAWL_CONCURRENCY` (default: `3`)
- `HQ_CONTENT_CRAWL_TIMEOUT_MS` (default: `8000`)
- `HQ_CONTENT_CRAWL_MAX_HTML_BYTES` (default: `1500000`)
- `HQ_CONTENT_CRAWL_MAX_TEXT_CHARS` (default: `120000`)
- `HQ_CONTENT_CRAWL_MAX_IMAGES` (default: `24`)
- `PG_POOL_MAX` (default: `10`)
- `PG_IDLE_TIMEOUT_MS` (default: `30000`)
- `PG_STATEMENT_TIMEOUT_MS` (default: `20000`)
- `PG_CONNECT_TIMEOUT_MS` (default: `10000`)
- `PG_SSL_DISABLE` (`1` 表示禁用 SSL)

### AI-news Consumer

- `ARTICLE_DB_BASE_URL` (optional；配置后 `/api/archive_articles` 将优先从 article-db 拉取)
- `ARTICLE_DB_API_TOKEN` (optional；消费端调用 article-db 时的 Bearer Token)

### DeepSeek

- `DEEPSEEK_API_KEY` (required)
- `DEEPSEEK_MODEL` (default: `deepseek-chat`)
- `DEEPSEEK_BASE_URL` (default: `https://api.deepseek.com`)
- `AI_EVAL_PROMPT_VERSION` (default: `v7`)

未配置 `DEEPSEEK_API_KEY` 时，程序会直接报错退出（不再提供规则摘要降级）。

### AI 评估缓存与抓取优先级

- `AI_EVAL_CACHE_DB` (default: `.cache/ai-news/article_eval.sqlite3`)
- `AI_EVAL_MAX_RETRIES` (default: `2`)
- `SOURCE_FETCH_BUDGET` (default: `60`, `0` 表示不限制)
- `MIN_FETCH_PER_SOURCE` (default: `3`, 保证每个源最少抓取量)
- `EXPANDED_DISCOVERY_MODE` (default: `true`，临时开关；`true` 时默认 `top_n=32` 且 `MAX_EVAL_ARTICLES=120`，`false` 时恢复 `top_n=16` 且 `MAX_EVAL_ARTICLES=60`)
- `MAX_EVAL_ARTICLES` (default: `120` when `EXPANDED_DISCOVERY_MODE=true`, else `60`)
- `MIN_HIGHLIGHT_SCORE` (default: `62`, 低于阈值不进入重点文章)
- `MIN_WORTH_READING_SCORE` (default: `58`, 可读文章进入重点清单的最低分)
- `MIN_HIGHLIGHT_CONFIDENCE` (default: `0.55`, 低置信度评估不进入重点文章)
- `HIGHLIGHT_DYNAMIC_PERCENTILE` (default: `70`, 按当日评分分布抬高重点门槛)
- `HIGHLIGHT_SELECTION_RATIO` (default: `1.0` when `EXPANDED_DISCOVERY_MODE=true`, else `0.45`)
- `HIGHLIGHT_MIN_COUNT` (default: `8` when `EXPANDED_DISCOVERY_MODE=true`, else `4`)
- `RSSHUB_BASE_URL` (optional, 例如: `https://rsshub.example.com`，用于启用 `sources.yaml` 中的 X/Twitter 源)
- `MAX_INFO_DUP_PER_DIGEST` (default: `2`, 任意文章在日报中的全局最大出现次数，不区分日期；进入当日评估池即计数，达到上限后不再进日报)
- `REPORT_ARTICLE_REPEAT_LIMIT_ENABLED` (default: `true`，是否启用「任意文章最多出现 2 次」阈值守卫；设为 `false` 可全局关闭)

系统会对每篇文章单独做 AI 质量评估并持久化缓存；同时根据近期评估结果更新「源质量分」，高质量源在抓取顺序和预算分配上优先。
重点文章会按当日质量门槛动态收缩，宁缺毋滥。

### 个性化点击反馈（302 Tracker）

- `TRACKER_BASE_URL` (optional，建议与当前服务域名一致，例如: `https://ai-news-liart.vercel.app`)
- `TRACKER_SIGNING_SECRET` (用于签名 `/api/r` 跳转链接)
- `TRACKER_API_TOKEN` (用于访问 `/api/stats/sources` 与 `/api/stats/types`)
- `TRACKER_INCLUDE_TYPE_PARAM` (default: `false`，开启后会把文章类型写入 `pt` 参数)
- `PERSONALIZATION_ENABLED` (default: `true`)
- `PERSONALIZATION_LOOKBACK_DAYS` (default: `90`)
- `PERSONALIZATION_HALF_LIFE_DAYS` (default: `21`)
- `PERSONALIZATION_MIN_MULTIPLIER` (default: `0.85`)
- `PERSONALIZATION_MAX_MULTIPLIER` (default: `1.20`)
- `EXPLORATION_RATIO` (default: `0.15`, 预留给非历史偏好源的抓取预算比例)
- `TYPE_PERSONALIZATION_ENABLED` (default: `true`)
- `TYPE_PERSONALIZATION_LOOKBACK_DAYS` (default: `90`)
- `TYPE_PERSONALIZATION_HALF_LIFE_DAYS` (default: `21`)
- `TYPE_PERSONALIZATION_MIN_MULTIPLIER` (default: `0.90`)
- `TYPE_PERSONALIZATION_MAX_MULTIPLIER` (default: `1.15`)
- `TYPE_PERSONALIZATION_BLEND` (default: `0.20`, 类型偏好对文章排序的融合强度)
- `TYPE_PERSONALIZATION_QUALITY_GAP_GUARD` (default: `8`, 超过分差不允许类型偏好反超)
- `ARTICLE_TYPES_CONFIG` (optional, default: `config/article_types.yaml`)
- `ANALYSIS_REPORT_ENABLED` (default: `true`，是否生成详尽分析报告)
- `ANALYSIS_AI_SUMMARY_ENABLED` (default: `true`，是否在规则化诊断基础上追加 AI 改进建议)
- `ARCHIVE_ENABLED` (default: `true`，是否写入日报正文归档)
- `ARCHIVE_ANALYSIS_ENABLED` (default: `false`，是否默认写入分析报告归档)
- `ARCHIVE_DEFAULT_DAYS` (default: `30`，首页默认展示最近归档天数)
- `ARCHIVE_DEFAULT_LIMIT_PER_DAY` (default: `10`，首页默认每日展示上限)

当 `TRACKER_BASE_URL + TRACKER_SIGNING_SECRET` 可用时，Markdown/flomo 输出链接会替换为签名 302 跳转链接；
点击数据会回流到本工程内置 tracker 接口（`/api/r`、`/api/stats/sources`、`/api/stats/types`），并在后续日报中温和影响抓取优先级、预算分配和文章类型排序。若 tracker 配置缺失，自动回退直链，不影响日报产出。

### X/Twitter 源说明（RSSHub）

`config/sources.yaml` 已内置一批 X/Twitter 作者源，默认通过 `rsshub_route` + `RSSHUB_BASE_URL` 自动拼接 URL。

- 未设置 `RSSHUB_BASE_URL` 时，这些 X 源会被自动跳过，不影响原有 RSS。
- 已设置 `RSSHUB_BASE_URL` 时，会自动启用这些 X 源。
- X 源默认启用 `only_external_links: true`，仅保留包含外链的推文，降低噪声。

### flomo Sync (optional)

- `FLOMO_API_URL` (enable sync when provided)

## Run Modes

```bash
# dev server
npm run dev

# production build
npm run build
npm run start

# manual trigger
curl -H "Authorization: Bearer $CRON_SECRET" "http://localhost:3000/api/v1/ingestion/run"
# import legacy archive (optional)
curl -H "Authorization: Bearer $CRON_SECRET" "http://localhost:3000/api/v1/migration/import-legacy?days=30&limit_per_day=10&article_limit_per_day=1000&overwrite=0"
```

## Vercel Cron Deployment

- Cron 配置在 `vercel.json`：`0 23 * * *` (UTC) = `07:00 Asia/Shanghai`
- 生产环境会定时调用 `GET /api/v1/ingestion/run`
- 内置 tracker 接口：
  - `GET /api/healthz`
  - `GET /api/r`
  - `GET /api/stats/sources?days=90`
  - `GET /api/stats/types?days=90`
- 归档接口（首页 H5 使用）：
  - `GET /api/archive?days=30&limit_per_day=10`
  - `GET /api/archive_item?id=<digest_id>`
  - `GET /api/archive_analysis?id=<digest_id>`
- 首页：
  - `GET /`（H5 页面，主体优先展示“今日文档”，页面末尾展示历史归档）
- 建议在 Vercel 项目中设置 `CRON_SECRET`，平台会自动在 cron 请求里注入 `Authorization: Bearer <CRON_SECRET>`
- 新服务建议部署在新加坡区域（`sin1`），并将 Postgres 主库放在新加坡。

部署命令：

```bash
npx vercel link
npx vercel deploy --prod
```

手动触发（用于验收）：

```bash
curl -H "Authorization: Bearer $CRON_SECRET" "https://<your-domain>/api/v1/ingestion/run"
# 如果调用链路会剥离 Authorization，可改用：
curl "https://<your-domain>/api/v1/ingestion/run?token=$CRON_SECRET"

# 导入旧归档（默认追加 upsert，不覆盖；overwrite=1 表示按天覆盖）
curl -H "Authorization: Bearer $CRON_SECRET" "https://<your-domain>/api/v1/migration/import-legacy?days=30&limit_per_day=10&article_limit_per_day=1000&overwrite=0&quality_score=62"
```
