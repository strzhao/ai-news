-- Add tag_groups and tag registry for AI-managed tag taxonomy

ALTER TABLE article_analysis
  ADD COLUMN IF NOT EXISTS tag_groups JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_analysis_tag_groups_gin
  ON article_analysis
  USING GIN (tag_groups jsonb_path_ops);

CREATE TABLE IF NOT EXISTS tag_registry (
  group_key TEXT NOT NULL,
  tag_key TEXT NOT NULL,
  display_name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  aliases JSONB NOT NULL DEFAULT '[]'::jsonb,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  managed_by TEXT NOT NULL DEFAULT 'ai',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (group_key, tag_key)
);

CREATE INDEX IF NOT EXISTS idx_tag_registry_group_key
  ON tag_registry (group_key, is_active, updated_at DESC);
