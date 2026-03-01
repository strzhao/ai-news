-- Add ingestion run heartbeat for stale-run watchdog

ALTER TABLE ingestion_runs
  ADD COLUMN IF NOT EXISTS heartbeat_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
