# ai-news-tracker

Lightweight Vercel redirect tracker for `ai-news`.

## Endpoints

- `GET /api/r`: signed 302 redirect + click aggregation
- `GET /api/stats/sources?days=90`: source-level click timeseries for personalization
- `GET /api/stats/types?days=90`: article-type click timeseries for personalization
- `GET /api/healthz`: health check

## Required Environment Variables

- `TRACKER_SIGNING_SECRET`
- `TRACKER_API_TOKEN`
- Redis REST credentials (either one set works):
  - `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN`
  - or `KV_REST_API_URL` + `KV_REST_API_TOKEN` (auto-injected when Vercel KV is linked)

## Deploy

```bash
cd tracker
npm install
vercel --prod
```

After deployment, set the returned domain in `ai-news`:

- `TRACKER_BASE_URL=https://<your-tracker-domain>`
- `TRACKER_SIGNING_SECRET=<same value as tracker>`
- `TRACKER_API_TOKEN=<same value as tracker>`
