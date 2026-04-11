# Repository Guidelines

## Project Structure & Module Organization
- `app/`: Next.js App Router pages and API handlers.
  - `app/api/`: public and internal endpoints (`/api/archive_articles`, `/api/v1/*`, tracker routes).
  - `app/components/`: shared client components (e.g., `sw-register.tsx`).
  - `app/archive-review/`: archive review UI.
- `lib/`: core business logic by domain.
  - `lib/domain/`: archive, tracker, and shared domain utilities.
  - `lib/output/`: markdown/flomo formatters.
  - `lib/integrations/`, `lib/tracking/`, `lib/fetch/`, `lib/llm/`: 外部客户端与消费层数据整合逻辑；文章主数据来自独立 `article-db` 服务。
  - `lib/client/`: browser-side API helpers (auth, flomo, web-push).
- `public/`: PWA assets (manifest.json, sw.js, icons).
- `tests-ts/`: Vitest unit/integration-style tests (`*.test.ts`).
- `config/`: source and type configuration YAML.

## Build, Test, and Development Commands
- `npm run dev`: run local Next.js dev server.
- `npm run build`: production build (also generates Next type artifacts).
- `npm run start`: run the built app.
- `npm run typecheck`: strict TypeScript check (`tsc --noEmit`).
- `npm test`: run all tests once with Vitest.
- `npm run test:watch`: watch mode for iterative testing.

## Coding Style & Naming Conventions
- Language: TypeScript (`strict: true`).
- Indentation: 2 spaces; keep functions small and explicit.
- Files: kebab-case for modules (e.g., `flomo-archive-articles-formatter.ts`); Next handlers use `route.ts`.
- Prefer named exports for shared utilities.
- Keep API responses stable: include `ok`, explicit error messages, and predictable keys.
- No dedicated lint script is configured; enforce style via consistency + typecheck + tests.

## Testing Guidelines
- Framework: Vitest (`tests-ts/`).
- Name tests as `*.test.ts`, grouped by feature/route.
- For API routes, test at least:
  - auth failures,
  - success path,
  - empty/fallback path,
  - external dependency failure path.
- Run `npm test` and `npm run typecheck` before opening a PR.

## Commit & Pull Request Guidelines
- Follow Conventional Commit style seen in history:
  - `feat: ...`, `fix: ...`, `chore: ...`, optionally scoped (`feat(归档): ...`).
- Keep each commit focused and runnable.
- PRs should include:
  - change summary,
  - affected endpoints/files,
  - env var changes,
  - test/build results,
  - screenshots for UI changes (`/`, `/archive-review`).

## Security & Configuration Tips
- Never commit secrets. Use `.env.local` for local values.
- Key sensitive vars: `CRON_SECRET`, `TRACKER_SIGNING_SECRET`, `ARTICLE_DB_API_TOKEN`, `FLOMO_API_URL`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`.
- When changing cron-triggered APIs, update both `vercel.json` and `README.md` together.
- `ai-news` 不应依赖 `DATABASE_URL` / `POSTGRES_URL*`；如果看到这些变量，默认视为历史残留，应从项目环境中删除。

## Flomo Integration Rules (Important)
- Flomo push uses two paths: `GET /api/v1/flomo/cron-push` (scheduled, iterates all subscribers) and `POST /api/v1/flomo/push` (user-triggered, per-user).
- Legacy digest flomo flow is removed intentionally; do not re-introduce `lib/output/flomo-formatter.ts` or digest-runner direct flomo sync.
- flomo tags must be appended at the very end of content.
- Tag source is `tag_groups` only (not primary/secondary type fallback).
- Tag format must be `#tag` with no spaces in tag text; normalize to snake_case-compatible keys.
- Tag canonicalization must reuse active `tag_registry` definitions (alias -> canonical).
- Preserve one-time consumption guarantees using existing Postgres state:
  - `flomo_archive_push_batches`
  - `flomo_archive_article_consumption`
