-- Add article-level quality feedback table for good/bad review signals

CREATE TABLE IF NOT EXISTS article_quality_feedback (
  id TEXT PRIMARY KEY,
  article_id TEXT NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  feedback TEXT NOT NULL,
  feedback_score DOUBLE PRECISION NOT NULL DEFAULT 0,
  source_id TEXT NOT NULL DEFAULT '',
  primary_type TEXT NOT NULL DEFAULT 'other',
  quality_score_snapshot DOUBLE PRECISION NOT NULL DEFAULT 0,
  confidence_snapshot DOUBLE PRECISION NOT NULL DEFAULT 0,
  worth_snapshot TEXT NOT NULL DEFAULT '',
  reason_short_snapshot TEXT NOT NULL DEFAULT '',
  action_hint_snapshot TEXT NOT NULL DEFAULT '',
  tag_groups_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  evidence_signals_snapshot JSONB NOT NULL DEFAULT '[]'::jsonb,
  context_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_article_quality_feedback_value CHECK (feedback IN ('good', 'bad'))
);

CREATE INDEX IF NOT EXISTS idx_article_quality_feedback_article_created
  ON article_quality_feedback (article_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_article_quality_feedback_source_created
  ON article_quality_feedback (source_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_article_quality_feedback_type_created
  ON article_quality_feedback (primary_type, created_at DESC);
