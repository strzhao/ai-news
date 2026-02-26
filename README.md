# AI News Daily Digest

每天北京时间 07:00 自动抓取优质 AI RSS，使用 DeepSeek 进行「单篇评估 + 汇总编排」生成中文日报（Top 8 + 一句话总结 + 必读/可读/跳过 + 本期技术标签），并可同步到 flomo。

## Quick Start

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python -m src.main --tz Asia/Shanghai
```

输出文件：`reports/YYYY-MM-DD.md`

## Environment Variables

### DeepSeek

- `DEEPSEEK_API_KEY` (required)
- `DEEPSEEK_MODEL` (default: `deepseek-chat`)
- `DEEPSEEK_BASE_URL` (default: `https://api.deepseek.com`)
- `AI_EVAL_PROMPT_VERSION` (default: `v5`)

未配置 `DEEPSEEK_API_KEY` 时，程序会直接报错退出（不再提供规则摘要降级）。

### AI 评估缓存与抓取优先级

- `AI_EVAL_CACHE_DB` (default: `.cache/ai-news/article_eval.sqlite3`)
- `AI_EVAL_MAX_RETRIES` (default: `2`)
- `SOURCE_FETCH_BUDGET` (default: `60`, `0` 表示不限制)
- `MIN_FETCH_PER_SOURCE` (default: `3`, 保证每个源最少抓取量)
- `MAX_EVAL_ARTICLES` (default: `60`)

系统会对每篇文章单独做 AI 质量评估并持久化缓存；同时根据近期评估结果更新「源质量分」，高质量源在抓取顺序和预算分配上优先。

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
- optional auto-commit by repository variable `AUTO_COMMIT_REPORTS=true`
