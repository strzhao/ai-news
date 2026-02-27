# AI News Daily Digest

每天北京时间 07:00 自动抓取优质 AI RSS，使用 DeepSeek 进行「单篇评估 + 汇总编排」生成中文日报（最多 Top 16 + 一句话总结 + 日报技术标签），并可同步到 flomo。

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
- `AI_EVAL_PROMPT_VERSION` (default: `v6`)

未配置 `DEEPSEEK_API_KEY` 时，程序会直接报错退出（不再提供规则摘要降级）。

### AI 评估缓存与抓取优先级

- `AI_EVAL_CACHE_DB` (default: `.cache/ai-news/article_eval.sqlite3`)
- `AI_EVAL_MAX_RETRIES` (default: `2`)
- `SOURCE_FETCH_BUDGET` (default: `60`, `0` 表示不限制)
- `MIN_FETCH_PER_SOURCE` (default: `3`, 保证每个源最少抓取量)
- `MAX_EVAL_ARTICLES` (default: `60`)
- `MIN_HIGHLIGHT_SCORE` (default: `62`, 低于阈值不进入重点文章)
- `MIN_WORTH_READING_SCORE` (default: `58`, 可读文章进入重点清单的最低分)
- `MIN_HIGHLIGHT_CONFIDENCE` (default: `0.55`, 低置信度评估不进入重点文章)
- `HIGHLIGHT_DYNAMIC_PERCENTILE` (default: `70`, 按当日评分分布抬高重点门槛)
- `HIGHLIGHT_SELECTION_RATIO` (default: `0.45`, 重点文章按评估池比例精选)
- `HIGHLIGHT_MIN_COUNT` (default: `4`, 保底最少重点文章数)
- `RSSHUB_BASE_URL` (optional, 例如: `https://rsshub.example.com`，用于启用 `sources.yaml` 中的 X/Twitter 源)
- `MAX_INFO_DUP_PER_DIGEST` (default: `2`, 同一信息在重点文章中最多出现次数)

系统会对每篇文章单独做 AI 质量评估并持久化缓存；同时根据近期评估结果更新「源质量分」，高质量源在抓取顺序和预算分配上优先。
重点文章是“最多 Top 16”，会按当日质量门槛动态收缩，宁缺毋滥。

### 个性化点击反馈（302 Tracker）

- `TRACKER_BASE_URL` (optional, 例如: `https://ai-news-tracker.vercel.app`)
- `TRACKER_SIGNING_SECRET` (optional, 与 tracker 服务保持一致)
- `TRACKER_API_TOKEN` (optional, 用于读取点击统计)
- `PERSONALIZATION_ENABLED` (default: `true`)
- `PERSONALIZATION_LOOKBACK_DAYS` (default: `90`)
- `PERSONALIZATION_HALF_LIFE_DAYS` (default: `21`)
- `PERSONALIZATION_MIN_MULTIPLIER` (default: `0.85`)
- `PERSONALIZATION_MAX_MULTIPLIER` (default: `1.20`)
- `EXPLORATION_RATIO` (default: `0.15`, 预留给非历史偏好源的抓取预算比例)

当 `TRACKER_BASE_URL + TRACKER_SIGNING_SECRET` 可用时，Markdown/flomo 输出链接会替换为签名 302 跳转链接；
点击数据会回流到 tracker，并在后续日报中温和影响抓取优先级和预算分配。若 tracker 配置缺失，自动回退直链，不影响日报产出。

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

## GitHub Actions

Workflow: `.github/workflows/daily_digest.yml`

- cron: `0 23 * * *` (UTC) = `07:00 Asia/Shanghai`
- supports manual `workflow_dispatch`
- restores `.cache/ai-news` to reduce repeated AI calls
- 默认会使用 `https://rsshub-vercel-deploy-cyan.vercel.app` 作为 `RSSHUB_BASE_URL`（可通过仓库变量 `RSSHUB_BASE_URL` 覆盖）
- optional auto-commit by repository variable `AUTO_COMMIT_REPORTS=true`

## Tracker Service

`tracker/` 目录是独立的 Vercel tracker 项目，可单独部署：

```bash
cd tracker
npm install
vercel --prod
```
