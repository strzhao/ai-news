# AI News Daily Digest

每天北京时间 07:00 自动抓取优质 AI RSS，使用 DeepSeek 进行「单篇评估 + 汇总编排」生成中文日报（重点文章 + 一句话总结 + 日报技术标签），并可同步到 flomo。

## Quick Start

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
ln -sf ../ai-news/.env .env
# share env from ../ai-news/.env to avoid duplicate maintenance
set -a; source .env; set +a
python -m src.main --tz Asia/Shanghai
```

输出文件：`reports/YYYY-MM-DD.md`

## Environment Variables

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
- `ARTICLE_TYPES_CONFIG` (optional, default: `src/config/article_types.yaml`)
- `ANALYSIS_REPORT_ENABLED` (default: `true`，是否生成详尽分析报告)
- `ANALYSIS_AI_SUMMARY_ENABLED` (default: `true`，是否在规则化诊断基础上追加 AI 改进建议)
- `ARCHIVE_ENABLED` (default: `true`，是否写入日报正文归档)
- `ARCHIVE_ANALYSIS_ENABLED` (default: `false`，是否默认写入分析报告归档)
- `ARCHIVE_DEFAULT_DAYS` (default: `30`，首页默认展示最近归档天数)
- `ARCHIVE_DEFAULT_LIMIT_PER_DAY` (default: `10`，首页默认每日展示上限)

当 `TRACKER_BASE_URL + TRACKER_SIGNING_SECRET` 可用时，Markdown/flomo 输出链接会替换为签名 302 跳转链接；
点击数据会回流到本工程内置 tracker 接口（`/api/r`、`/api/stats/sources`、`/api/stats/types`），并在后续日报中温和影响抓取优先级、预算分配和文章类型排序。若 tracker 配置缺失，自动回退直链，不影响日报产出。

### X/Twitter 源说明（RSSHub）

`src/config/sources.yaml` 已内置一批 X/Twitter 作者源，默认通过 `rsshub_route` + `RSSHUB_BASE_URL` 自动拼接 URL。

- 未设置 `RSSHUB_BASE_URL` 时，这些 X 源会被自动跳过，不影响原有 RSS。
- 已设置 `RSSHUB_BASE_URL` 时，会自动启用这些 X 源。
- X 源默认启用 `only_external_links: true`，仅保留包含外链的推文，降低噪声。

### flomo Sync (optional)

- `FLOMO_API_URL` (enable sync when provided)

## Run Modes

```bash
# normal run (auto sync flomo only when FLOMO_API_URL exists)
python -m src.main --tz Asia/Shanghai

# force sync / disable sync
python -m src.main --sync-flomo
python -m src.main --no-sync-flomo
```

## Vercel Cron Deployment

- Cron 配置在 `vercel.json`：`0 23 * * *` (UTC) = `07:00 Asia/Shanghai`
- 生产环境会定时调用 `GET /api/cron_digest`
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
- `api/cron_digest.py` 默认将运行时写目录设为：
  - `AI_EVAL_CACHE_DB=/tmp/ai-news/article_eval.sqlite3`
  - `DIGEST_OUTPUT_DIR=/tmp/reports`

部署命令：

```bash
npx vercel link
npx vercel deploy --prod
```

手动触发（用于验收）：

```bash
curl -H "Authorization: Bearer $CRON_SECRET" "https://<your-domain>/api/cron_digest"
# 如果调用链路会剥离 Authorization，可改用：
curl "https://<your-domain>/api/cron_digest?token=$CRON_SECRET"
# 临时忽略“最多出现 2 次”阈值（仅本次运行）：
curl -H "Authorization: Bearer $CRON_SECRET" "https://<your-domain>/api/cron_digest?ignore_repeat_limit=1"
# 临时开启“分析报告归档入库”（默认关闭）：
curl -H "Authorization: Bearer $CRON_SECRET" "https://<your-domain>/api/cron_digest?archive_analysis=1"
```

## Node CLI (ai-news)

新增一个 Node.js 运维 CLI，支持高频手动操作与验收：

- 触发日报：`trigger`
- 归档查询：`archive list/item/analysis`
- 消费统计：`stats sources/types`
- 健康检查：`health`

目录：`tools/ai-news-cli`

CLI 会自动尝试加载 `.env`（从当前目录向上查找多级），因此在仓库根目录放置 `.env` 后通常无需手动 `source`。

安装依赖：

```bash
cd tools/ai-news-cli
npm install
```

本地运行：

```bash
# 触发一次日报（Header 鉴权优先）
npm run dev -- trigger --base-url https://ai-news.stringzhao.life --token "$CRON_SECRET"

# 若要临时忽略重复阈值，必须显式 --force
npm run dev -- trigger --base-url https://ai-news.stringzhao.life --token "$CRON_SECRET" --ignore-repeat-limit --force

# 查询最近 7 天归档
npm run dev -- archive list --base-url https://ai-news.stringzhao.life --days 7 --limit-per-day 10

# 查询 tracker 来源统计
npm run dev -- stats sources --base-url https://ai-news.stringzhao.life --tracker-token "$TRACKER_API_TOKEN" --days 30
```

构建并生成可执行入口：

```bash
npm run build
./dist/index.js health --base-url https://ai-news.stringzhao.life
```

环境变量（可替代命令参数）：

- `AI_NEWS_BASE_URL`
- `AI_NEWS_CRON_SECRET`
- `AI_NEWS_TRACKER_TOKEN`
- `AI_NEWS_TIMEOUT_MS` (default `15000`)
- `CRON_SECRET`（可作为 `AI_NEWS_CRON_SECRET` 兜底）
- `TRACKER_API_TOKEN`（可作为 `AI_NEWS_TRACKER_TOKEN` 兜底）

说明：`trigger` 命令在未显式设置 `AI_NEWS_TIMEOUT_MS` / `--timeout-ms` 时，会默认使用 `300000ms`，避免长耗时生成被过早超时。

JSON 输出（用于脚本集成）：

```bash
npm run dev -- trigger --base-url https://ai-news.stringzhao.life --token "$CRON_SECRET" --json
```
