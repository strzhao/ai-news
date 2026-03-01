-- Add feedback events for AI-first tag governance learning loop

CREATE TABLE IF NOT EXISTS tag_governance_feedback (
  id TEXT PRIMARY KEY,
  objective_id TEXT NOT NULL DEFAULT 'default',
  event_type TEXT NOT NULL,
  group_key TEXT NOT NULL DEFAULT '',
  tag_key TEXT NOT NULL DEFAULT '',
  score DOUBLE PRECISION NOT NULL DEFAULT 0,
  weight DOUBLE PRECISION NOT NULL DEFAULT 1,
  source TEXT NOT NULL DEFAULT 'unknown',
  context_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tag_governance_feedback_created_at
  ON tag_governance_feedback (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_tag_governance_feedback_objective
  ON tag_governance_feedback (objective_id, event_type, created_at DESC);
