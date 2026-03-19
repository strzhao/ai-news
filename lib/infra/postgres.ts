import { Pool } from "pg";

declare global {
  // eslint-disable-next-line no-var
  var __aiNewsPgPool: Pool | undefined;
}

function buildPool(): Pool {
  const connectionString = String(process.env.DATABASE_URL || "").trim();
  if (!connectionString) {
    throw new Error("Missing DATABASE_URL for article-db service");
  }

  return new Pool({
    connectionString,
    max: Math.max(
      2,
      Number.parseInt(String(process.env.PG_POOL_MAX || "10"), 10) || 10,
    ),
    idleTimeoutMillis: Math.max(
      1_000,
      Number.parseInt(String(process.env.PG_IDLE_TIMEOUT_MS || "30000"), 10) ||
        30_000,
    ),
    statement_timeout: Math.max(
      1_000,
      Number.parseInt(
        String(process.env.PG_STATEMENT_TIMEOUT_MS || "20000"),
        10,
      ) || 20_000,
    ),
    connectionTimeoutMillis: Math.max(
      1_000,
      Number.parseInt(
        String(process.env.PG_CONNECT_TIMEOUT_MS || "10000"),
        10,
      ) || 10_000,
    ),
    ssl:
      process.env.PG_SSL_DISABLE === "1"
        ? false
        : { rejectUnauthorized: false },
  });
}

export function getPgPool(): Pool {
  if (!global.__aiNewsPgPool) {
    global.__aiNewsPgPool = buildPool();
  }
  return global.__aiNewsPgPool;
}

export function getPgPoolOrNull(): Pool | null {
  try {
    return getPgPool();
  } catch {
    return null;
  }
}
