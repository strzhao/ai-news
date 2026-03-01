-- Add full daily analyzed snapshot table (high + general quality)

CREATE TABLE IF NOT EXISTS daily_analyzed_articles (
  date DATE NOT NULL,
  article_id TEXT NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  quality_score_snapshot DOUBLE PRECISION NOT NULL,
  rank_score DOUBLE PRECISION NOT NULL,
  analyzed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (date, article_id)
);

CREATE INDEX IF NOT EXISTS idx_daily_analyzed_date
  ON daily_analyzed_articles (date DESC, rank_score DESC);

INSERT INTO daily_analyzed_articles (date, article_id, quality_score_snapshot, rank_score, analyzed_at)
SELECT date, article_id, quality_score_snapshot, rank_score, selected_at
FROM daily_high_quality_articles
ON CONFLICT (date, article_id) DO NOTHING;
