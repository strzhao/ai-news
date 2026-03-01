-- Add AI-first tag governance objective and run audit tables

CREATE TABLE IF NOT EXISTS tag_governance_objectives (
  objective_id TEXT PRIMARY KEY,
  config_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS tag_governance_runs (
  id TEXT PRIMARY KEY,
  objective_id TEXT NOT NULL DEFAULT 'default',
  status TEXT NOT NULL DEFAULT 'running',
  dry_run BOOLEAN NOT NULL DEFAULT TRUE,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ,
  request_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  context_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  planner_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  critic_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  applied_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  error_message TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_tag_governance_runs_started_at
  ON tag_governance_runs (started_at DESC);
