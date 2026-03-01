-- Article DB baseline schema (Singapore deployment target)

CREATE TABLE IF NOT EXISTS sources (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT '',
  feed_url TEXT NOT NULL,
  source_weight DOUBLE PRECISION NOT NULL DEFAULT 1,
  only_external_links BOOLEAN NOT NULL DEFAULT FALSE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS articles (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES sources(id) ON UPDATE CASCADE,
  canonical_url TEXT NOT NULL UNIQUE,
  original_url TEXT NOT NULL,
  info_url TEXT NOT NULL,
  title TEXT NOT NULL,
  published_at TIMESTAMPTZ,
  summary_raw TEXT NOT NULL DEFAULT '',
  lead_paragraph TEXT NOT NULL DEFAULT '',
  content_text TEXT NOT NULL DEFAULT '',
  source_host TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS article_analysis (
  article_id TEXT PRIMARY KEY REFERENCES articles(id) ON DELETE CASCADE,
  model_name TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  quality_score DOUBLE PRECISION NOT NULL DEFAULT 0,
  confidence DOUBLE PRECISION NOT NULL DEFAULT 0,
  worth TEXT NOT NULL DEFAULT '',
  one_line_summary TEXT NOT NULL DEFAULT '',
  reason_short TEXT NOT NULL DEFAULT '',
  action_hint TEXT NOT NULL DEFAULT '',
  company_impact DOUBLE PRECISION NOT NULL DEFAULT 0,
  team_impact DOUBLE PRECISION NOT NULL DEFAULT 0,
  personal_impact DOUBLE PRECISION NOT NULL DEFAULT 0,
  execution_clarity DOUBLE PRECISION NOT NULL DEFAULT 0,
  novelty_score DOUBLE PRECISION NOT NULL DEFAULT 0,
  clarity_score DOUBLE PRECISION NOT NULL DEFAULT 0,
  best_for_roles JSONB NOT NULL DEFAULT '[]'::jsonb,
  evidence_signals JSONB NOT NULL DEFAULT '[]'::jsonb,
  primary_type TEXT NOT NULL DEFAULT 'other',
  secondary_types JSONB NOT NULL DEFAULT '[]'::jsonb,
  raw_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  analyzed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS daily_high_quality_articles (
  date DATE NOT NULL,
  article_id TEXT NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  quality_score_snapshot DOUBLE PRECISION NOT NULL,
  rank_score DOUBLE PRECISION NOT NULL,
  selected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (date, article_id)
);

CREATE TABLE IF NOT EXISTS daily_analyzed_articles (
  date DATE NOT NULL,
  article_id TEXT NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  quality_score_snapshot DOUBLE PRECISION NOT NULL,
  rank_score DOUBLE PRECISION NOT NULL,
  analyzed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (date, article_id)
);

CREATE TABLE IF NOT EXISTS ingestion_runs (
  id TEXT PRIMARY KEY,
  run_date DATE NOT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ,
  status TEXT NOT NULL,
  fetched_count INTEGER NOT NULL DEFAULT 0,
  deduped_count INTEGER NOT NULL DEFAULT 0,
  analyzed_count INTEGER NOT NULL DEFAULT 0,
  selected_count INTEGER NOT NULL DEFAULT 0,
  error_message TEXT NOT NULL DEFAULT '',
  stats_json JSONB NOT NULL DEFAULT '{}'::jsonb
);

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

CREATE INDEX IF NOT EXISTS idx_articles_published_at ON articles (published_at DESC);
CREATE INDEX IF NOT EXISTS idx_analysis_quality_score ON article_analysis (quality_score DESC, analyzed_at DESC);
CREATE INDEX IF NOT EXISTS idx_daily_high_quality_date ON daily_high_quality_articles (date DESC, rank_score DESC);
CREATE INDEX IF NOT EXISTS idx_daily_analyzed_date ON daily_analyzed_articles (date DESC, rank_score DESC);
CREATE INDEX IF NOT EXISTS idx_ingestion_runs_date ON ingestion_runs (run_date DESC, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_tag_governance_runs_started_at ON tag_governance_runs (started_at DESC);
CREATE INDEX IF NOT EXISTS idx_tag_governance_feedback_created_at ON tag_governance_feedback (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tag_governance_feedback_objective ON tag_governance_feedback (objective_id, event_type, created_at DESC);
