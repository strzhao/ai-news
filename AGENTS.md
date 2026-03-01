# Repository Guidelines

## Project Structure & Module Organization
- `app/`: Next.js App Router pages and API handlers.
  - `app/api/`: public and internal endpoints (`/api/archive_articles`, `/api/v1/*`, tracker routes).
  - `app/archive-review/`: archive review UI.
- `lib/`: core business logic by domain.
  - `lib/article-db/`: ingestion, repository, auth, migration.
  - `lib/domain/`: archive, tracker, and shared domain utilities.
  - `lib/output/`: markdown/flomo formatters.
  - `lib/integrations/`, `lib/tracking/`, `lib/fetch/`, `lib/llm/`: external clients and pipelines.
- `tests-ts/`: Vitest unit/integration-style tests (`*.test.ts`).
- `config/`: source and type configuration YAML.
- `db/`: SQL or DB artifacts.

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
- Key sensitive vars: `CRON_SECRET`, `TRACKER_SIGNING_SECRET`, `ARTICLE_DB_API_TOKEN`, `FLOMO_API_URL`.
- When changing cron-triggered APIs, update both `vercel.json` and `README.md` together.
