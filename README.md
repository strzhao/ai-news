# AI News Daily Digest

每天北京时间 07:00 自动抓取优质 AI RSS，使用 DeepSeek 全量生成中文日报（Top 8 + 一句话总结 + 必读/可读/跳过 + 本期技术标签），并可同步到 flomo。

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

未配置 `DEEPSEEK_API_KEY` 时，程序会直接报错退出（不再提供规则摘要降级）。

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
- optional auto-commit by repository variable `AUTO_COMMIT_REPORTS=true`
