import crypto from "node:crypto";
import type { PoolClient } from "pg";
import { Article, ArticleAssessment, SourceConfig } from "@/lib/domain/models";
import { normalizeUrl } from "@/lib/domain/tracker-common";
import { getPgPool } from "@/lib/infra/postgres";
import {
  ArticleContentSnapshot,
  ArchivedArticleRow,
  ArticleQualityFeedback,
  ArticleQualityFeedbackEvent,
  FeedbackAdjustmentMap,
  HighQualityArticleDetail,
  HighQualityArticleGroup,
  HighQualityArticleItem,
  IngestionRunRow,
  PersistedArticleImage,
  QualityTier,
  TagDefinition,
  TagGovernanceFeedbackEvent,
  TagGovernanceFeedbackStat,
  TagGovernanceObjectiveRow,
  TagGovernanceRunRow,
  TagGroupRow,
  TagUsageStat,
} from "@/lib/article-db/types";

let schemaReady: Promise<void> | null = null;
const MAX_FULL_CONTENT_TEXT_CHARS = 500_000;
const MAX_FULL_CONTENT_HTML_CHARS = 2_000_000;
const MAX_RELATED_IMAGES_PER_ARTICLE = 120;
const FLOMO_ARCHIVE_PUSH_LOCK_ID = 781_002_901;

export type FlomoArchivePushBatchStatus = "pending" | "sent" | "failed";

export interface FlomoArchivePushBatchRow {
  batchKey: string;
  sourceDate: string;
  status: FlomoArchivePushBatchStatus;
  articleIds: string[];
  payloadContent: string;
  createdAt: string;
  sentAt: string;
  lastError: string;
}

function toHost(rawUrl: string): string {
  try {
    return new URL(rawUrl).host || "";
  } catch {
    return "";
  }
}

function toCanonicalUrl(article: Article): string {
  const base = String(article.infoUrl || article.url || "").trim();
  return normalizeUrl(base);
}

function stableArticleId(canonicalUrl: string): string {
  return crypto.createHash("sha256").update(canonicalUrl).digest("hex").slice(0, 24);
}

function normalizeDate(date: string): string {
  const raw = String(date || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    throw new Error(`Invalid date: ${raw}`);
  }
  return raw;
}

function normalizeQualityTier(value: string | undefined, fallback: QualityTier = "high"): QualityTier {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw) return fallback;
  if (["high", "hq", "default"].includes(raw)) return "high";
  if (["general", "normal", "common", "non_high"].includes(raw)) return "general";
  if (["all", "any"].includes(raw)) return "all";
  return fallback;
}

function boundedScore(value: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(0, Math.min(100, value));
}

function tierByScore(score: number, threshold: number): QualityTier {
  return Number(score || 0) >= threshold ? "high" : "general";
}

function toIso(value: unknown): string {
  if (!value) return "";
  try {
    return new Date(String(value)).toISOString();
  } catch {
    return "";
  }
}

function toDateString(value: unknown): string {
  if (!value) return "";
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  const raw = String(value).trim();
  if (!raw) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return raw;
  }
  const parsed = new Date(raw);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toISOString().slice(0, 10);
  }
  return raw;
}

function parseStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => String(item || "").trim()).filter(Boolean);
  }
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) {
        return parsed.map((item) => String(item || "").trim()).filter(Boolean);
      }
    } catch {
      return [];
    }
  }
  return [];
}

function parseFlomoArchivePushStatus(value: unknown): FlomoArchivePushBatchStatus {
  const raw = String(value || "").trim().toLowerCase();
  if (raw === "sent") return "sent";
  if (raw === "failed") return "failed";
  return "pending";
}

function rowToFlomoArchivePushBatch(row: Record<string, unknown>): FlomoArchivePushBatchRow {
  return {
    batchKey: String(row.batch_key || ""),
    sourceDate: toDateString(row.source_date),
    status: parseFlomoArchivePushStatus(row.status),
    articleIds: parseStringArray(row.article_ids_json),
    payloadContent: String(row.payload_content || ""),
    createdAt: toIso(row.created_at),
    sentAt: toIso(row.sent_at),
    lastError: String(row.last_error || ""),
  };
}

function parseJsonObject(value: unknown): Record<string, unknown> {
  if (!value) return {};
  if (typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return {};
    }
  }
  return {};
}

function normalizeTagKey(value: string): string {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_\-]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function parseTagGroups(value: unknown): Record<string, string[]> {
  if (!value) return {};

  let parsed: unknown = value;
  if (typeof value === "string") {
    try {
      parsed = JSON.parse(value);
    } catch {
      return {};
    }
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return {};
  }

  const input = parsed as Record<string, unknown>;
  const output: Record<string, string[]> = {};
  Object.entries(input).forEach(([groupKey, tags]) => {
    const normalizedGroup = normalizeTagKey(groupKey);
    if (!normalizedGroup) return;
    const normalizedTags = parseStringArray(tags)
      .map((tag) => normalizeTagKey(tag))
      .filter(Boolean);
    if (!normalizedTags.length) return;
    output[normalizedGroup] = Array.from(new Set(normalizedTags)).slice(0, 24);
  });
  return output;
}

function parsePersistedArticleImages(value: unknown): PersistedArticleImage[] {
  let parsed: unknown = value;
  if (!parsed) return [];
  if (typeof parsed === "string") {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(parsed)) {
    return [];
  }
  return parsed
    .map((item, index) => {
      if (!item || typeof item !== "object") return null;
      const row = item as Record<string, unknown>;
      const imageUrl = String(row.image_url || "").trim();
      if (!imageUrl) return null;
      return {
        image_index: Math.max(0, Number.parseInt(String(row.image_index ?? index), 10) || 0),
        image_url: imageUrl,
        alt_text: String(row.alt_text || "").trim(),
      };
    })
    .filter((item): item is PersistedArticleImage => Boolean(item))
    .sort((left, right) => left.image_index - right.image_index);
}

function parseRunRow(row: Record<string, unknown>): IngestionRunRow {
  let statsJson: Record<string, unknown> = {};
  try {
    const raw = row.stats_json;
    if (raw && typeof raw === "object") {
      statsJson = raw as Record<string, unknown>;
    } else if (typeof raw === "string" && raw.trim()) {
      statsJson = JSON.parse(raw);
    }
  } catch {
    statsJson = {};
  }

  return {
    id: String(row.id || ""),
    run_date: toDateString(row.run_date),
    status: String(row.status || ""),
    started_at: toIso(row.started_at),
    heartbeat_at: toIso(row.heartbeat_at),
    finished_at: toIso(row.finished_at),
    fetched_count: Number(row.fetched_count || 0),
    deduped_count: Number(row.deduped_count || 0),
    analyzed_count: Number(row.analyzed_count || 0),
    selected_count: Number(row.selected_count || 0),
    error_message: String(row.error_message || ""),
    stats_json: statsJson,
  };
}

function parseGovernanceObjectiveRow(row: Record<string, unknown>): TagGovernanceObjectiveRow {
  return {
    objective_id: String(row.objective_id || "default"),
    config_json: parseJsonObject(row.config_json),
    updated_at: toIso(row.updated_at),
  };
}

function parseGovernanceRunRow(row: Record<string, unknown>): TagGovernanceRunRow {
  return {
    id: String(row.id || ""),
    objective_id: String(row.objective_id || "default"),
    status: String(row.status || ""),
    dry_run: Boolean(row.dry_run),
    started_at: toIso(row.started_at),
    finished_at: toIso(row.finished_at),
    request_json: parseJsonObject(row.request_json),
    context_json: parseJsonObject(row.context_json),
    planner_json: parseJsonObject(row.planner_json),
    critic_json: parseJsonObject(row.critic_json),
    applied_json: parseJsonObject(row.applied_json),
    error_message: String(row.error_message || ""),
  };
}

function parseGovernanceFeedbackEventRow(row: Record<string, unknown>): TagGovernanceFeedbackEvent {
  return {
    id: String(row.id || ""),
    objective_id: String(row.objective_id || "default"),
    event_type: String(row.event_type || ""),
    group_key: normalizeTagKey(String(row.group_key || "")),
    tag_key: normalizeTagKey(String(row.tag_key || "")),
    score: Number(row.score || 0),
    weight: Number(row.weight || 1),
    source: String(row.source || "unknown"),
    context_json: parseJsonObject(row.context_json),
    created_at: toIso(row.created_at),
  };
}

function normalizeFeedbackValue(value: string): ArticleQualityFeedback {
  const raw = String(value || "").trim().toLowerCase();
  return raw === "bad" ? "bad" : "good";
}

function parseArticleQualityFeedbackRow(row: Record<string, unknown>): ArticleQualityFeedbackEvent {
  return {
    id: String(row.id || ""),
    article_id: String(row.article_id || ""),
    feedback: normalizeFeedbackValue(String(row.feedback || "")),
    feedback_score: Number(row.feedback_score || 0),
    source_id: String(row.source_id || ""),
    primary_type: normalizeTagKey(String(row.primary_type || "other")) || "other",
    quality_score_snapshot: Number(row.quality_score_snapshot || 0),
    confidence_snapshot: Number(row.confidence_snapshot || 0),
    worth_snapshot: String(row.worth_snapshot || ""),
    reason_short_snapshot: String(row.reason_short_snapshot || ""),
    action_hint_snapshot: String(row.action_hint_snapshot || ""),
    tag_groups_snapshot: parseTagGroups(row.tag_groups_snapshot),
    evidence_signals_snapshot: parseStringArray(row.evidence_signals_snapshot),
    context_json: parseJsonObject(row.context_json),
    created_at: toIso(row.created_at),
  };
}

function rowToArchivedArticle(
  row: Record<string, unknown>,
  qualityThreshold: number,
): ArchivedArticleRow {
  const snapshotScore = Number(row.quality_score_snapshot || 0);
  const derivedTier = tierByScore(snapshotScore, qualityThreshold);
  const qualityTierRaw = normalizeQualityTier(String(row.quality_tier || ""), derivedTier);
  const qualityTier = qualityTierRaw === "all" ? derivedTier : qualityTierRaw;
  return {
    article_id: String(row.article_id || ""),
    date: toDateString(row.date),
    analyzed_at: toIso(row.analyzed_at),
    selected_at: toIso(row.selected_at),
    is_selected: Boolean(row.is_selected),
    source_id: String(row.source_id || ""),
    source_name: String(row.source_name || ""),
    source_host: String(row.source_host || ""),
    title: String(row.title || ""),
    canonical_url: String(row.canonical_url || ""),
    original_url: String(row.original_url || ""),
    info_url: String(row.info_url || ""),
    published_at: toIso(row.published_at),
    summary_raw: String(row.summary_raw || ""),
    lead_paragraph: String(row.lead_paragraph || ""),
    quality_score_snapshot: snapshotScore,
    rank_score: Number(row.rank_score || 0),
    quality_score: Number(row.quality_score || 0),
    confidence: Number(row.confidence || 0),
    worth: String(row.worth || ""),
    one_line_summary: String(row.one_line_summary || ""),
    reason_short: String(row.reason_short || ""),
    action_hint: String(row.action_hint || ""),
    company_impact: Number(row.company_impact || 0),
    team_impact: Number(row.team_impact || 0),
    personal_impact: Number(row.personal_impact || 0),
    execution_clarity: Number(row.execution_clarity || 0),
    novelty_score: Number(row.novelty_score || 0),
    clarity_score: Number(row.clarity_score || 0),
    best_for_roles: parseStringArray(row.best_for_roles),
    evidence_signals: parseStringArray(row.evidence_signals),
    primary_type: normalizeTagKey(String(row.primary_type || "other")) || "other",
    secondary_types: parseStringArray(row.secondary_types),
    tag_groups: parseTagGroups(row.tag_groups),
    quality_tier: qualityTier,
    feedback_good_count: Number(row.feedback_good_count || 0),
    feedback_bad_count: Number(row.feedback_bad_count || 0),
    feedback_total_count: Number(row.feedback_total_count || 0),
    feedback_last: String(row.feedback_last || ""),
    feedback_last_at: toIso(row.feedback_last_at),
  };
}

export async function ensureArticleDbSchema(): Promise<void> {
  if (schemaReady) {
    return schemaReady;
  }

  schemaReady = (async () => {
    const pool = getPgPool();
    await pool.query(`
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
        content_full_text TEXT NOT NULL DEFAULT '',
        content_full_html TEXT NOT NULL DEFAULT '',
        content_full_source_url TEXT NOT NULL DEFAULT '',
        content_full_updated_at TIMESTAMPTZ,
        content_full_error TEXT NOT NULL DEFAULT '',
        source_host TEXT NOT NULL DEFAULT '',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS article_related_images (
        article_id TEXT NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
        image_index INTEGER NOT NULL,
        image_url TEXT NOT NULL,
        alt_text TEXT NOT NULL DEFAULT '',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (article_id, image_index)
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
        tag_groups JSONB NOT NULL DEFAULT '{}'::jsonb,
        raw_json JSONB NOT NULL DEFAULT '{}'::jsonb,
        analyzed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

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
        heartbeat_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
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

      CREATE TABLE IF NOT EXISTS flomo_archive_push_batches (
        batch_key TEXT PRIMARY KEY,
        source_date DATE NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        article_ids_json JSONB NOT NULL DEFAULT '[]'::jsonb,
        payload_content TEXT NOT NULL DEFAULT '',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        sent_at TIMESTAMPTZ,
        last_error TEXT NOT NULL DEFAULT '',
        CONSTRAINT chk_flomo_archive_push_batches_status CHECK (status IN ('pending', 'sent', 'failed'))
      );

      CREATE TABLE IF NOT EXISTS flomo_archive_article_consumption (
        article_id TEXT PRIMARY KEY,
        source_date DATE NOT NULL,
        batch_key TEXT NOT NULL REFERENCES flomo_archive_push_batches(batch_key) ON UPDATE CASCADE ON DELETE RESTRICT,
        consumed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      ALTER TABLE article_analysis ADD COLUMN IF NOT EXISTS tag_groups JSONB NOT NULL DEFAULT '{}'::jsonb;
      ALTER TABLE ingestion_runs ADD COLUMN IF NOT EXISTS heartbeat_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
      ALTER TABLE articles ADD COLUMN IF NOT EXISTS content_full_text TEXT NOT NULL DEFAULT '';
      ALTER TABLE articles ADD COLUMN IF NOT EXISTS content_full_html TEXT NOT NULL DEFAULT '';
      ALTER TABLE articles ADD COLUMN IF NOT EXISTS content_full_source_url TEXT NOT NULL DEFAULT '';
      ALTER TABLE articles ADD COLUMN IF NOT EXISTS content_full_updated_at TIMESTAMPTZ;
      ALTER TABLE articles ADD COLUMN IF NOT EXISTS content_full_error TEXT NOT NULL DEFAULT '';

      CREATE INDEX IF NOT EXISTS idx_articles_published_at ON articles (published_at DESC);
      CREATE INDEX IF NOT EXISTS idx_articles_content_full_updated_at ON articles (content_full_updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_analysis_quality_score ON article_analysis (quality_score DESC, analyzed_at DESC);
      CREATE INDEX IF NOT EXISTS idx_analysis_tag_groups_gin ON article_analysis USING GIN (tag_groups jsonb_path_ops);
      CREATE INDEX IF NOT EXISTS idx_daily_high_quality_date ON daily_high_quality_articles (date DESC, rank_score DESC);
      CREATE INDEX IF NOT EXISTS idx_daily_analyzed_date ON daily_analyzed_articles (date DESC, rank_score DESC);
      CREATE INDEX IF NOT EXISTS idx_daily_high_quality_article_date ON daily_high_quality_articles (article_id, date);
      CREATE INDEX IF NOT EXISTS idx_daily_analyzed_article_date ON daily_analyzed_articles (article_id, date);
      CREATE INDEX IF NOT EXISTS idx_ingestion_runs_date ON ingestion_runs (run_date DESC, started_at DESC);
      CREATE INDEX IF NOT EXISTS idx_article_related_images_article ON article_related_images (article_id, image_index);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_article_related_images_article_url
        ON article_related_images (article_id, image_url);
      CREATE INDEX IF NOT EXISTS idx_tag_registry_group_key ON tag_registry (group_key, is_active, updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_tag_governance_runs_started_at ON tag_governance_runs (started_at DESC);
      CREATE INDEX IF NOT EXISTS idx_tag_governance_feedback_created_at ON tag_governance_feedback (created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_tag_governance_feedback_objective ON tag_governance_feedback (objective_id, event_type, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_article_quality_feedback_article_created
        ON article_quality_feedback (article_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_article_quality_feedback_source_created
        ON article_quality_feedback (source_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_article_quality_feedback_type_created
        ON article_quality_feedback (primary_type, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_flomo_archive_push_batches_status_created
        ON flomo_archive_push_batches (status, created_at ASC);
      CREATE INDEX IF NOT EXISTS idx_flomo_archive_push_batches_source_date
        ON flomo_archive_push_batches (source_date DESC, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_flomo_archive_article_consumption_source_date
        ON flomo_archive_article_consumption (source_date DESC, consumed_at DESC);

      INSERT INTO daily_analyzed_articles (date, article_id, quality_score_snapshot, rank_score, analyzed_at)
      SELECT date, article_id, quality_score_snapshot, rank_score, selected_at
      FROM daily_high_quality_articles
      ON CONFLICT (date, article_id) DO NOTHING;
    `);
  })().catch((error) => {
    schemaReady = null;
    throw error;
  });

  return schemaReady;
}

async function withTx<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const pool = getPgPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function upsertSources(sources: SourceConfig[]): Promise<void> {
  if (!sources.length) return;
  await ensureArticleDbSchema();
  await withTx(async (client) => {
    for (const source of sources) {
      await client.query(
        `
        INSERT INTO sources (id, name, type, feed_url, source_weight, only_external_links, is_active, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, TRUE, NOW())
        ON CONFLICT (id)
        DO UPDATE SET
          name = EXCLUDED.name,
          type = EXCLUDED.type,
          feed_url = EXCLUDED.feed_url,
          source_weight = EXCLUDED.source_weight,
          only_external_links = EXCLUDED.only_external_links,
          is_active = TRUE,
          updated_at = NOW()
      `,
        [
          source.id,
          source.name,
          String(source.sourceType || ""),
          source.url,
          Number(source.sourceWeight || 1),
          Boolean(source.onlyExternalLinks),
        ],
      );
    }
  });
}

export async function upsertArticles(articles: Article[]): Promise<Record<string, string>> {
  if (!articles.length) return {};
  await ensureArticleDbSchema();
  const idMap: Record<string, string> = {};

  await withTx(async (client) => {
    for (const article of articles) {
      const canonicalUrl = toCanonicalUrl(article);
      if (!canonicalUrl) {
        continue;
      }
      const articleId = stableArticleId(canonicalUrl);
      const infoUrl = String(article.infoUrl || article.url || "").trim();
      const originalUrl = String(article.url || infoUrl).trim();
      const sourceHost = toHost(canonicalUrl);

      await client.query(
        `
        INSERT INTO articles (
          id,
          source_id,
          canonical_url,
          original_url,
          info_url,
          title,
          published_at,
          summary_raw,
          lead_paragraph,
          content_text,
          source_host,
          updated_at
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NOW())
        ON CONFLICT (canonical_url)
        DO UPDATE SET
          source_id = EXCLUDED.source_id,
          original_url = EXCLUDED.original_url,
          info_url = EXCLUDED.info_url,
          title = EXCLUDED.title,
          published_at = EXCLUDED.published_at,
          summary_raw = EXCLUDED.summary_raw,
          lead_paragraph = EXCLUDED.lead_paragraph,
          content_text = EXCLUDED.content_text,
          source_host = EXCLUDED.source_host,
          updated_at = NOW()
      `,
        [
          articleId,
          article.sourceId,
          canonicalUrl,
          originalUrl,
          infoUrl,
          article.title,
          article.publishedAt ? article.publishedAt.toISOString() : null,
          article.summaryRaw,
          article.leadParagraph,
          article.contentText,
          sourceHost,
        ],
      );

      idMap[article.id] = articleId;
    }
  });

  return idMap;
}

export async function listArticleContentTargets(
  articleIds: string[],
): Promise<Array<{ articleId: string; sourceUrl: string }>> {
  await ensureArticleDbSchema();
  const normalizedIds = Array.from(new Set(articleIds.map((id) => String(id || "").trim()).filter(Boolean)));
  if (!normalizedIds.length) return [];

  const pool = getPgPool();
  const result = await pool.query(
    `
    SELECT
      id AS article_id,
      info_url,
      original_url,
      canonical_url
    FROM articles
    WHERE id = ANY($1::text[])
  `,
    [normalizedIds],
  );

  return result.rows
    .map((raw) => {
      const row = raw as Record<string, unknown>;
      const articleId = String(row.article_id || "").trim();
      if (!articleId) return null;
      const sourceUrl =
        String(row.info_url || "").trim() || String(row.original_url || "").trim() || String(row.canonical_url || "").trim();
      if (!sourceUrl) return null;
      return {
        articleId,
        sourceUrl,
      };
    })
    .filter((item): item is { articleId: string; sourceUrl: string } => Boolean(item));
}

export async function upsertArticleContentSnapshots(snapshots: ArticleContentSnapshot[]): Promise<void> {
  if (!snapshots.length) return;
  await ensureArticleDbSchema();

  const deduped = new Map<string, ArticleContentSnapshot>();
  snapshots.forEach((snapshot) => {
    const articleId = String(snapshot.article_id || "").trim();
    if (!articleId) return;
    deduped.set(articleId, snapshot);
  });

  if (!deduped.size) return;

  await withTx(async (client) => {
    for (const [articleId, snapshot] of deduped.entries()) {
      const fullTextRaw = String(snapshot.content_text || "").trim();
      const fullHtmlRaw = String(snapshot.content_html || "").trim();
      const sourceUrl = String(snapshot.resolved_url || snapshot.source_url || "").trim();
      const contentError = String(snapshot.content_error || "").trim();

      const fullText =
        fullTextRaw.length > MAX_FULL_CONTENT_TEXT_CHARS
          ? `${fullTextRaw.slice(0, MAX_FULL_CONTENT_TEXT_CHARS).trimEnd()}…`
          : fullTextRaw;
      const fullHtml =
        fullHtmlRaw.length > MAX_FULL_CONTENT_HTML_CHARS
          ? `${fullHtmlRaw.slice(0, MAX_FULL_CONTENT_HTML_CHARS).trimEnd()}…`
          : fullHtmlRaw;

      const updated = await client.query(
        `
        UPDATE articles
        SET
          content_full_text = $2,
          content_full_html = $3,
          content_full_source_url = $4,
          content_full_updated_at = NOW(),
          content_full_error = $5,
          updated_at = NOW()
        WHERE id = $1
      `,
        [articleId, fullText, fullHtml, sourceUrl, contentError],
      );
      if (Number(updated.rowCount || 0) <= 0) {
        continue;
      }

      await client.query(`DELETE FROM article_related_images WHERE article_id = $1`, [articleId]);

      const imageRows = new Map<string, PersistedArticleImage>();
      (snapshot.images || []).forEach((image, index) => {
        const imageUrl = String(image.image_url || "").trim();
        if (!imageUrl) return;
        if (imageRows.has(imageUrl)) return;
        imageRows.set(imageUrl, {
          image_index: Math.max(0, Number.parseInt(String(image.image_index ?? index), 10) || 0),
          image_url: imageUrl,
          alt_text: String(image.alt_text || "").trim(),
        });
      });

      const sortedImages = Array.from(imageRows.values())
        .sort((left, right) => left.image_index - right.image_index)
        .slice(0, MAX_RELATED_IMAGES_PER_ARTICLE)
        .map((image, index) => ({
          ...image,
          image_index: index,
        }));

      for (const image of sortedImages) {
        await client.query(
          `
          INSERT INTO article_related_images (
            article_id,
            image_index,
            image_url,
            alt_text,
            updated_at
          )
          VALUES ($1, $2, $3, $4, NOW())
          ON CONFLICT (article_id, image_index)
          DO UPDATE SET
            image_url = EXCLUDED.image_url,
            alt_text = EXCLUDED.alt_text,
            updated_at = NOW()
        `,
          [articleId, image.image_index, image.image_url, image.alt_text],
        );
      }
    }
  });
}

export async function upsertArticleAnalyses(params: {
  inputToStoredId: Record<string, string>;
  assessments: Record<string, ArticleAssessment>;
  modelName: string;
  promptVersion: string;
}): Promise<void> {
  await ensureArticleDbSchema();
  await withTx(async (client) => {
    const discoveredTags = new Map<string, { groupKey: string; tagKey: string; displayName: string }>();

    for (const [inputArticleId, assessment] of Object.entries(params.assessments)) {
      const storedId = params.inputToStoredId[inputArticleId];
      if (!storedId) continue;
      const tagGroups = parseTagGroups(assessment.tagGroups);
      const rawJson = {
        article_id: assessment.articleId,
        worth: assessment.worth,
        quality_score: assessment.qualityScore,
        one_line_summary: assessment.oneLineSummary,
        reason_short: assessment.reasonShort,
        action_hint: assessment.actionHint,
        confidence: assessment.confidence,
        primary_type: assessment.primaryType,
        secondary_types: assessment.secondaryTypes,
        tag_groups: tagGroups,
      };

      await client.query(
        `
        INSERT INTO article_analysis (
          article_id,
          model_name,
          prompt_version,
          quality_score,
          confidence,
          worth,
          one_line_summary,
          reason_short,
          action_hint,
          company_impact,
          team_impact,
          personal_impact,
          execution_clarity,
          novelty_score,
          clarity_score,
          best_for_roles,
          evidence_signals,
          primary_type,
          secondary_types,
          tag_groups,
          raw_json,
          analyzed_at
        )
        VALUES (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
          $11,$12,$13,$14,$15,$16::jsonb,$17::jsonb,$18,$19::jsonb,$20::jsonb,$21::jsonb,NOW()
        )
        ON CONFLICT (article_id)
        DO UPDATE SET
          model_name = EXCLUDED.model_name,
          prompt_version = EXCLUDED.prompt_version,
          quality_score = EXCLUDED.quality_score,
          confidence = EXCLUDED.confidence,
          worth = EXCLUDED.worth,
          one_line_summary = EXCLUDED.one_line_summary,
          reason_short = EXCLUDED.reason_short,
          action_hint = EXCLUDED.action_hint,
          company_impact = EXCLUDED.company_impact,
          team_impact = EXCLUDED.team_impact,
          personal_impact = EXCLUDED.personal_impact,
          execution_clarity = EXCLUDED.execution_clarity,
          novelty_score = EXCLUDED.novelty_score,
          clarity_score = EXCLUDED.clarity_score,
          best_for_roles = EXCLUDED.best_for_roles,
          evidence_signals = EXCLUDED.evidence_signals,
          primary_type = EXCLUDED.primary_type,
          secondary_types = EXCLUDED.secondary_types,
          tag_groups = EXCLUDED.tag_groups,
          raw_json = EXCLUDED.raw_json,
          analyzed_at = NOW()
      `,
        [
          storedId,
          params.modelName,
          params.promptVersion,
          Number(assessment.qualityScore || 0),
          Number(assessment.confidence || 0),
          assessment.worth,
          assessment.oneLineSummary,
          assessment.reasonShort,
          assessment.actionHint,
          Number(assessment.companyImpact || 0),
          Number(assessment.teamImpact || 0),
          Number(assessment.personalImpact || 0),
          Number(assessment.executionClarity || 0),
          Number(assessment.noveltyScore || 0),
          Number(assessment.clarityScore || 0),
          JSON.stringify(assessment.bestForRoles || []),
          JSON.stringify(assessment.evidenceSignals || []),
          String(assessment.primaryType || "other") || "other",
          JSON.stringify(assessment.secondaryTypes || []),
          JSON.stringify(tagGroups),
          JSON.stringify(rawJson),
        ],
      );

      Object.entries(tagGroups).forEach(([groupKey, tags]) => {
        tags.forEach((tagKey) => {
          const normalizedGroup = normalizeTagKey(groupKey);
          const normalizedTag = normalizeTagKey(tagKey);
          if (!normalizedGroup || !normalizedTag) return;
          discoveredTags.set(`${normalizedGroup}:${normalizedTag}`, {
            groupKey: normalizedGroup,
            tagKey: normalizedTag,
            displayName: normalizedTag,
          });
        });
      });
    }

    if (discoveredTags.size) {
      for (const row of discoveredTags.values()) {
        await client.query(
          `
          INSERT INTO tag_registry (
            group_key,
            tag_key,
            display_name,
            description,
            aliases,
            is_active,
            managed_by,
            updated_at
          )
          VALUES ($1, $2, $3, '', '[]'::jsonb, TRUE, 'ai_auto', NOW())
          ON CONFLICT (group_key, tag_key)
          DO UPDATE SET
            display_name = EXCLUDED.display_name,
            is_active = TRUE,
            updated_at = NOW()
        `,
          [row.groupKey, row.tagKey, row.displayName],
        );
      }
    }
  });
}

export async function replaceDailyHighQuality(
  date: string,
  rows: Array<{ articleId: string; qualityScoreSnapshot: number; rankScore: number }>,
): Promise<void> {
  await ensureArticleDbSchema();
  const normalizedDate = normalizeDate(date);

  await withTx(async (client) => {
    await client.query(`DELETE FROM daily_high_quality_articles WHERE date = $1::date`, [normalizedDate]);

    for (const row of rows) {
      await client.query(
        `
        INSERT INTO daily_high_quality_articles (date, article_id, quality_score_snapshot, rank_score, selected_at)
        VALUES ($1::date, $2, $3, $4, NOW())
      `,
        [normalizedDate, row.articleId, row.qualityScoreSnapshot, row.rankScore],
      );
    }
  });
}

export async function upsertDailyHighQuality(
  date: string,
  rows: Array<{ articleId: string; qualityScoreSnapshot: number; rankScore: number }>,
): Promise<void> {
  await ensureArticleDbSchema();
  const normalizedDate = normalizeDate(date);
  if (!rows.length) {
    return;
  }

  await withTx(async (client) => {
    for (const row of rows) {
      await client.query(
        `
        INSERT INTO daily_high_quality_articles (date, article_id, quality_score_snapshot, rank_score, selected_at)
        VALUES ($1::date, $2, $3, $4, NOW())
        ON CONFLICT (date, article_id)
        DO UPDATE SET
          quality_score_snapshot = EXCLUDED.quality_score_snapshot,
          rank_score = EXCLUDED.rank_score,
          selected_at = NOW()
      `,
        [normalizedDate, row.articleId, row.qualityScoreSnapshot, row.rankScore],
      );
    }
  });
}

export async function removeDailyHighQualityByArticleIds(date: string, articleIds: string[]): Promise<number> {
  await ensureArticleDbSchema();
  const normalizedDate = normalizeDate(date);
  const normalizedIds = Array.from(new Set(articleIds.map((id) => String(id || "").trim()).filter(Boolean)));
  if (!normalizedIds.length) {
    return 0;
  }

  const pool = getPgPool();
  const result = await pool.query(
    `
    DELETE FROM daily_high_quality_articles
    WHERE date = $1::date
      AND article_id = ANY($2::text[])
  `,
    [normalizedDate, normalizedIds],
  );
  return Number(result.rowCount || 0);
}

export async function pruneDailyHighQualityByCurrentScore(date: string, minScore: number): Promise<number> {
  await ensureArticleDbSchema();
  const normalizedDate = normalizeDate(date);
  const boundedMinScore = boundedScore(minScore, 62);
  const pool = getPgPool();
  const result = await pool.query(
    `
    DELETE FROM daily_high_quality_articles d
    USING article_analysis aa
    WHERE d.date = $1::date
      AND aa.article_id = d.article_id
      AND aa.quality_score < $2::double precision
  `,
    [normalizedDate, boundedMinScore],
  );
  return Number(result.rowCount || 0);
}

export async function replaceDailyAnalyzed(
  date: string,
  rows: Array<{ articleId: string; qualityScoreSnapshot: number; rankScore: number }>,
): Promise<void> {
  await ensureArticleDbSchema();
  const normalizedDate = normalizeDate(date);

  await withTx(async (client) => {
    await client.query(`DELETE FROM daily_analyzed_articles WHERE date = $1::date`, [normalizedDate]);

    for (const row of rows) {
      await client.query(
        `
        INSERT INTO daily_analyzed_articles (date, article_id, quality_score_snapshot, rank_score, analyzed_at)
        VALUES ($1::date, $2, $3, $4, NOW())
      `,
        [normalizedDate, row.articleId, row.qualityScoreSnapshot, row.rankScore],
      );
    }
  });
}

export async function upsertDailyAnalyzed(
  date: string,
  rows: Array<{ articleId: string; qualityScoreSnapshot: number; rankScore: number }>,
): Promise<void> {
  await ensureArticleDbSchema();
  const normalizedDate = normalizeDate(date);
  if (!rows.length) {
    return;
  }

  await withTx(async (client) => {
    for (const row of rows) {
      await client.query(
        `
        INSERT INTO daily_analyzed_articles (date, article_id, quality_score_snapshot, rank_score, analyzed_at)
        VALUES ($1::date, $2, $3, $4, NOW())
        ON CONFLICT (date, article_id)
        DO UPDATE SET
          quality_score_snapshot = EXCLUDED.quality_score_snapshot,
          rank_score = EXCLUDED.rank_score,
          analyzed_at = NOW()
      `,
        [normalizedDate, row.articleId, row.qualityScoreSnapshot, row.rankScore],
      );
    }
  });
}

export async function createIngestionRun(runDate: string): Promise<string> {
  await ensureArticleDbSchema();
  const normalizedDate = normalizeDate(runDate);
  const runId = `${normalizedDate}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const pool = getPgPool();
  await pool.query(
    `
    INSERT INTO ingestion_runs (id, run_date, status, started_at, heartbeat_at)
    VALUES ($1, $2::date, 'running', NOW(), NOW())
  `,
    [runId, normalizedDate],
  );
  return runId;
}

export async function touchIngestionRun(runId: string): Promise<void> {
  await ensureArticleDbSchema();
  const normalizedRunId = String(runId || "").trim();
  if (!normalizedRunId) return;
  const pool = getPgPool();
  await pool.query(
    `
    UPDATE ingestion_runs
    SET heartbeat_at = NOW()
    WHERE id = $1
  `,
    [normalizedRunId],
  );
}

export async function failStaleIngestionRuns(params: { runDate?: string; staleSeconds: number }): Promise<number> {
  await ensureArticleDbSchema();
  const staleSeconds = Math.max(60, Math.min(86_400, Math.trunc(params.staleSeconds || 600)));
  const runDateOrNull = params.runDate ? normalizeDate(params.runDate) : null;
  const pool = getPgPool();
  const result = await pool.query(
    `
    UPDATE ingestion_runs
    SET
      status = 'failed',
      finished_at = NOW(),
      heartbeat_at = NOW(),
      error_message = CASE
        WHEN COALESCE(error_message, '') = '' THEN 'Marked failed by stale-run watchdog'
        ELSE error_message
      END
    WHERE status = 'running'
      AND (heartbeat_at <= NOW() - ($1::int * INTERVAL '1 second') OR started_at <= NOW() - ($1::int * INTERVAL '1 second'))
      AND ($2::date IS NULL OR run_date = $2::date)
  `,
    [staleSeconds, runDateOrNull],
  );
  return Number(result.rowCount || 0);
}

export async function finishIngestionRun(params: {
  runId: string;
  status: "success" | "failed";
  fetchedCount: number;
  dedupedCount: number;
  analyzedCount: number;
  selectedCount: number;
  errorMessage?: string;
  statsJson?: Record<string, unknown>;
}): Promise<void> {
  await ensureArticleDbSchema();
  const pool = getPgPool();
  await pool.query(
    `
    UPDATE ingestion_runs
    SET
      status = $2,
      finished_at = NOW(),
      heartbeat_at = NOW(),
      fetched_count = $3,
      deduped_count = $4,
      analyzed_count = $5,
      selected_count = $6,
      error_message = $7,
      stats_json = $8::jsonb
    WHERE id = $1
  `,
    [
      params.runId,
      params.status,
      Math.max(0, Math.trunc(params.fetchedCount || 0)),
      Math.max(0, Math.trunc(params.dedupedCount || 0)),
      Math.max(0, Math.trunc(params.analyzedCount || 0)),
      Math.max(0, Math.trunc(params.selectedCount || 0)),
      String(params.errorMessage || ""),
      JSON.stringify(params.statsJson || {}),
    ],
  );
}

export async function tryAcquireFlomoArchivePushLock(): Promise<boolean> {
  await ensureArticleDbSchema();
  const pool = getPgPool();
  const result = await pool.query(`SELECT pg_try_advisory_lock($1::bigint) AS locked`, [FLOMO_ARCHIVE_PUSH_LOCK_ID]);
  const row = (result.rows[0] || {}) as Record<string, unknown>;
  return Boolean(row.locked);
}

export async function releaseFlomoArchivePushLock(): Promise<void> {
  const pool = getPgPool();
  await pool.query(`SELECT pg_advisory_unlock($1::bigint) AS unlocked`, [FLOMO_ARCHIVE_PUSH_LOCK_ID]);
}

export async function getNextRetryableFlomoArchivePushBatch(): Promise<FlomoArchivePushBatchRow | null> {
  await ensureArticleDbSchema();
  const pool = getPgPool();
  const result = await pool.query(
    `
    SELECT
      batch_key,
      source_date,
      status,
      article_ids_json,
      payload_content,
      created_at,
      sent_at,
      last_error
    FROM flomo_archive_push_batches
    WHERE status IN ('pending', 'failed')
    ORDER BY
      CASE WHEN status = 'pending' THEN 0 ELSE 1 END ASC,
      created_at ASC
    LIMIT 1
  `,
  );
  if (!result.rows.length) {
    return null;
  }
  return rowToFlomoArchivePushBatch(result.rows[0] as Record<string, unknown>);
}

export async function createFlomoArchivePushBatch(params: {
  batchKey: string;
  sourceDate: string;
  articleIds: string[];
  payloadContent: string;
}): Promise<FlomoArchivePushBatchRow> {
  await ensureArticleDbSchema();
  const batchKey = String(params.batchKey || "").trim();
  if (!batchKey) {
    throw new Error("Missing batchKey");
  }
  const sourceDate = normalizeDate(params.sourceDate);
  const articleIds = Array.from(new Set(params.articleIds.map((id) => String(id || "").trim()).filter(Boolean)));
  if (!articleIds.length) {
    throw new Error("Missing articleIds");
  }
  const payloadContent = String(params.payloadContent || "");

  const pool = getPgPool();
  const result = await pool.query(
    `
    INSERT INTO flomo_archive_push_batches (
      batch_key,
      source_date,
      status,
      article_ids_json,
      payload_content,
      created_at,
      sent_at,
      last_error
    )
    VALUES ($1, $2::date, 'pending', $3::jsonb, $4, NOW(), NULL, '')
    RETURNING
      batch_key,
      source_date,
      status,
      article_ids_json,
      payload_content,
      created_at,
      sent_at,
      last_error
  `,
    [batchKey, sourceDate, JSON.stringify(articleIds), payloadContent],
  );

  return rowToFlomoArchivePushBatch(result.rows[0] as Record<string, unknown>);
}

export async function markFlomoArchivePushBatchFailed(params: { batchKey: string; errorMessage: string }): Promise<void> {
  await ensureArticleDbSchema();
  const batchKey = String(params.batchKey || "").trim();
  if (!batchKey) {
    return;
  }

  const pool = getPgPool();
  await pool.query(
    `
    UPDATE flomo_archive_push_batches
    SET
      status = 'failed',
      last_error = $2
    WHERE batch_key = $1
      AND status <> 'sent'
  `,
    [batchKey, String(params.errorMessage || "").slice(0, 2000)],
  );
}

export async function markFlomoArchivePushBatchSent(batchKeyInput: string): Promise<number> {
  await ensureArticleDbSchema();
  const batchKey = String(batchKeyInput || "").trim();
  if (!batchKey) {
    throw new Error("Missing batchKey");
  }

  return withTx(async (client) => {
    const batchResult = await client.query(
      `
      SELECT batch_key, source_date, article_ids_json
      FROM flomo_archive_push_batches
      WHERE batch_key = $1
      FOR UPDATE
    `,
      [batchKey],
    );
    if (!batchResult.rows.length) {
      throw new Error(`Flomo push batch not found: ${batchKey}`);
    }
    const batchRow = batchResult.rows[0] as Record<string, unknown>;
    const sourceDate = normalizeDate(toDateString(batchRow.source_date));
    const articleIds = Array.from(new Set(parseStringArray(batchRow.article_ids_json)));

    let consumedCount = 0;
    for (const articleId of articleIds) {
      const inserted = await client.query(
        `
        INSERT INTO flomo_archive_article_consumption (article_id, source_date, batch_key, consumed_at)
        VALUES ($1, $2::date, $3, NOW())
        ON CONFLICT (article_id) DO NOTHING
      `,
        [articleId, sourceDate, batchKey],
      );
      consumedCount += Number(inserted.rowCount || 0);
    }

    await client.query(
      `
      UPDATE flomo_archive_push_batches
      SET
        status = 'sent',
        sent_at = NOW(),
        last_error = ''
      WHERE batch_key = $1
    `,
      [batchKey],
    );

    return consumedCount;
  });
}

export async function listConsumedFlomoArchiveArticleIds(articleIds: string[]): Promise<Set<string>> {
  await ensureArticleDbSchema();
  const normalizedIds = Array.from(new Set(articleIds.map((id) => String(id || "").trim()).filter(Boolean)));
  if (!normalizedIds.length) {
    return new Set<string>();
  }

  const pool = getPgPool();
  const result = await pool.query(
    `
    SELECT article_id
    FROM flomo_archive_article_consumption
    WHERE article_id = ANY($1::text[])
  `,
    [normalizedIds],
  );

  return new Set(
    result.rows
      .map((raw) => String((raw as Record<string, unknown>).article_id || "").trim())
      .filter(Boolean),
  );
}

function rowToHighQualityItem(row: Record<string, unknown>, qualityTier: QualityTier): HighQualityArticleItem {
  const date = toDateString(row.date);
  const generatedAt = toIso(row.selected_at || row.analyzed_at);
  return {
    article_id: String(row.article_id || ""),
    title: String(row.title || ""),
    url: String(row.info_url || row.original_url || ""),
    summary: String(row.one_line_summary || row.lead_paragraph || row.summary_raw || "").trim(),
    image_url: String(row.image_url || ""),
    source_host: String(row.source_host || ""),
    source_id: String(row.source_id || ""),
    source_name: String(row.source_name || ""),
    date,
    digest_id: `article_db_${date}`,
    generated_at: generatedAt,
    quality_score: Number(row.quality_score_snapshot || row.quality_score || 0),
    quality_tier: qualityTier,
    confidence: Number(row.confidence || 0),
    primary_type: String(row.primary_type || "other"),
    secondary_types: parseStringArray(row.secondary_types),
    tag_groups: parseTagGroups(row.tag_groups),
  };
}

export function buildFirstSeenUniqueHighQualityGroups(params: {
  rows: Array<Record<string, unknown>>;
  firstSeenByArticleId: Map<string, string>;
  limitPerDay: number;
  qualityTier: QualityTier;
  qualityThreshold: number;
}): { groups: HighQualityArticleGroup[]; totalArticles: number } {
  const limitPerDay = Math.max(1, Math.min(Math.trunc(params.limitPerDay), 200));
  const byDate = new Map<
    string,
    Array<{ row: Record<string, unknown>; rankScore: number; generatedAtMs: number; articleId: string }>
  >();

  for (const raw of params.rows) {
    const row = raw as Record<string, unknown>;
    const articleId = String(row.article_id || "").trim();
    const date = toDateString(row.date);
    if (!articleId || !date) {
      continue;
    }

    const firstSeenDate = params.firstSeenByArticleId.get(articleId);
    if (!firstSeenDate || firstSeenDate !== date) {
      continue;
    }

    const generatedAtMs = new Date(String(row.selected_at || row.analyzed_at || "")).getTime();
    const bucket = byDate.get(date) || [];
    bucket.push({
      row,
      rankScore: Number(row.rank_score || 0),
      generatedAtMs: Number.isNaN(generatedAtMs) ? 0 : generatedAtMs,
      articleId,
    });
    byDate.set(date, bucket);
  }

  const groups = Array.from(byDate.entries())
    .sort(([left], [right]) => right.localeCompare(left))
    .map(([date, candidates]) => {
      const items = candidates
        .sort((left, right) => {
          if (right.rankScore !== left.rankScore) {
            return right.rankScore - left.rankScore;
          }
          if (right.generatedAtMs !== left.generatedAtMs) {
            return right.generatedAtMs - left.generatedAtMs;
          }
          return left.articleId.localeCompare(right.articleId);
        })
        .slice(0, limitPerDay)
        .map((entry) => {
          const tier =
            params.qualityTier === "all"
              ? tierByScore(Number(entry.row.quality_score_snapshot || 0), params.qualityThreshold)
              : params.qualityTier;
          return rowToHighQualityItem(entry.row, tier);
        });

      return {
        date,
        items,
      };
    })
    .filter((group) => group.items.length > 0);

  const totalArticles = groups.reduce((sum, group) => sum + group.items.length, 0);
  return {
    groups,
    totalArticles,
  };
}

export async function listHighQualityByDate(params: {
  date: string;
  limit: number;
  offset: number;
  tagGroup?: string;
  tag?: string;
  qualityTier?: string;
  qualityThreshold?: number;
}): Promise<{ total: number; items: HighQualityArticleItem[] }> {
  await ensureArticleDbSchema();
  const pool = getPgPool();
  const date = normalizeDate(params.date);
  const limit = Math.max(1, Math.min(Math.trunc(params.limit), 200));
  const offset = Math.max(0, Math.min(Math.trunc(params.offset), 10_000));
  const tagGroup = normalizeTagKey(params.tagGroup || "");
  const tag = normalizeTagKey(params.tag || "");
  const qualityTier = normalizeQualityTier(params.qualityTier, "high");
  const qualityThreshold = boundedScore(
    Number(params.qualityThreshold ?? Number.parseFloat(String(process.env.QUALITY_SCORE_THRESHOLD || "62"))),
    62,
  );
  const tagGroupOrNull = tagGroup || null;
  const tagOrNull = tag || null;

  if (qualityTier === "high") {
    const totalRow = await pool.query<{ total: string | number }>(
      `
      SELECT COUNT(*) AS total
      FROM daily_high_quality_articles d
      INNER JOIN article_analysis aa ON aa.article_id = d.article_id
      WHERE d.date = $1::date
        AND aa.quality_score >= $4::double precision
        AND ($2::text IS NULL OR aa.tag_groups ? $2::text)
        AND (
          $3::text IS NULL OR
          CASE
            WHEN $2::text IS NOT NULL THEN EXISTS (
              SELECT 1
              FROM jsonb_array_elements_text(COALESCE(aa.tag_groups -> $2::text, '[]'::jsonb)) AS tag_item(tag)
              WHERE tag_item.tag = $3::text
            )
            ELSE EXISTS (
              SELECT 1
              FROM jsonb_each(aa.tag_groups) AS kv
              CROSS JOIN LATERAL jsonb_array_elements_text(COALESCE(kv.value, '[]'::jsonb)) AS tag_item(tag)
              WHERE tag_item.tag = $3::text
            )
          END
        )
    `,
      [date, tagGroupOrNull, tagOrNull, qualityThreshold],
    );

    const result = await pool.query(
      `
      SELECT
        d.date,
        d.selected_at,
        d.quality_score_snapshot,
        d.rank_score,
        a.id AS article_id,
        a.source_id,
        s.name AS source_name,
        a.title,
        a.original_url,
        a.info_url,
        a.summary_raw,
        a.lead_paragraph,
        a.source_host,
        aa.quality_score,
        aa.confidence,
        aa.one_line_summary,
        aa.primary_type,
        aa.secondary_types,
        aa.tag_groups,
        COALESCE(img.image_url, '') AS image_url
      FROM daily_high_quality_articles d
      INNER JOIN articles a ON a.id = d.article_id
      INNER JOIN sources s ON s.id = a.source_id
      INNER JOIN article_analysis aa ON aa.article_id = a.id
      LEFT JOIN LATERAL (
        SELECT image_url
        FROM article_related_images
        WHERE article_id = a.id
        ORDER BY image_index ASC
        LIMIT 1
      ) img ON TRUE
      WHERE d.date = $1::date
        AND aa.quality_score >= $6::double precision
        AND ($4::text IS NULL OR aa.tag_groups ? $4::text)
        AND (
          $5::text IS NULL OR
          CASE
            WHEN $4::text IS NOT NULL THEN EXISTS (
              SELECT 1
              FROM jsonb_array_elements_text(COALESCE(aa.tag_groups -> $4::text, '[]'::jsonb)) AS tag_item(tag)
              WHERE tag_item.tag = $5::text
            )
            ELSE EXISTS (
              SELECT 1
              FROM jsonb_each(aa.tag_groups) AS kv
              CROSS JOIN LATERAL jsonb_array_elements_text(COALESCE(kv.value, '[]'::jsonb)) AS tag_item(tag)
              WHERE tag_item.tag = $5::text
            )
          END
        )
      ORDER BY d.rank_score DESC, d.selected_at DESC
      LIMIT $2 OFFSET $3
    `,
      [date, limit, offset, tagGroupOrNull, tagOrNull, qualityThreshold],
    );

    return {
      total: Number(totalRow.rows[0]?.total || 0),
      items: result.rows.map((row) => rowToHighQualityItem(row as Record<string, unknown>, "high")),
    };
  }

  const totalRow = await pool.query<{ total: string | number }>(
    `
    SELECT COUNT(*) AS total
    FROM daily_analyzed_articles d
    INNER JOIN article_analysis aa ON aa.article_id = d.article_id
    WHERE d.date = $1::date
      AND (
        $2::text = 'all'
        OR ($2::text = 'general' AND d.quality_score_snapshot < $3::double precision)
      )
      AND ($4::text IS NULL OR aa.tag_groups ? $4::text)
      AND (
        $5::text IS NULL OR
        CASE
          WHEN $4::text IS NOT NULL THEN EXISTS (
            SELECT 1
            FROM jsonb_array_elements_text(COALESCE(aa.tag_groups -> $4::text, '[]'::jsonb)) AS tag_item(tag)
            WHERE tag_item.tag = $5::text
          )
          ELSE EXISTS (
            SELECT 1
            FROM jsonb_each(aa.tag_groups) AS kv
            CROSS JOIN LATERAL jsonb_array_elements_text(COALESCE(kv.value, '[]'::jsonb)) AS tag_item(tag)
            WHERE tag_item.tag = $5::text
          )
        END
      )
  `,
    [date, qualityTier, qualityThreshold, tagGroupOrNull, tagOrNull],
  );

  const result = await pool.query(
    `
    SELECT
      d.date,
      d.analyzed_at,
      d.quality_score_snapshot,
      d.rank_score,
      a.id AS article_id,
      a.source_id,
      s.name AS source_name,
      a.title,
      a.original_url,
      a.info_url,
      a.summary_raw,
      a.lead_paragraph,
      a.source_host,
      aa.quality_score,
      aa.confidence,
      aa.one_line_summary,
      aa.primary_type,
      aa.secondary_types,
      aa.tag_groups,
      COALESCE(img.image_url, '') AS image_url
    FROM daily_analyzed_articles d
    INNER JOIN articles a ON a.id = d.article_id
    INNER JOIN sources s ON s.id = a.source_id
    INNER JOIN article_analysis aa ON aa.article_id = a.id
    LEFT JOIN LATERAL (
      SELECT image_url
      FROM article_related_images
      WHERE article_id = a.id
      ORDER BY image_index ASC
      LIMIT 1
    ) img ON TRUE
    WHERE d.date = $1::date
      AND (
        $4::text = 'all'
        OR ($4::text = 'general' AND d.quality_score_snapshot < $5::double precision)
      )
      AND ($6::text IS NULL OR aa.tag_groups ? $6::text)
      AND (
        $7::text IS NULL OR
        CASE
          WHEN $6::text IS NOT NULL THEN EXISTS (
            SELECT 1
            FROM jsonb_array_elements_text(COALESCE(aa.tag_groups -> $6::text, '[]'::jsonb)) AS tag_item(tag)
            WHERE tag_item.tag = $7::text
          )
          ELSE EXISTS (
            SELECT 1
            FROM jsonb_each(aa.tag_groups) AS kv
            CROSS JOIN LATERAL jsonb_array_elements_text(COALESCE(kv.value, '[]'::jsonb)) AS tag_item(tag)
            WHERE tag_item.tag = $7::text
          )
        END
      )
    ORDER BY d.rank_score DESC, d.analyzed_at DESC
    LIMIT $2 OFFSET $3
  `,
    [date, limit, offset, qualityTier, qualityThreshold, tagGroupOrNull, tagOrNull],
  );

  return {
    total: Number(totalRow.rows[0]?.total || 0),
    items: result.rows.map((raw) => {
      const row = raw as Record<string, unknown>;
      const tier = qualityTier === "all" ? tierByScore(Number(row.quality_score_snapshot || 0), qualityThreshold) : "general";
      return rowToHighQualityItem(row, tier);
    }),
  };
}

export async function listHighQualityRange(params: {
  fromDate: string;
  toDate: string;
  limitPerDay: number;
  tagGroup?: string;
  tag?: string;
  qualityTier?: string;
  qualityThreshold?: number;
}): Promise<{ groups: HighQualityArticleGroup[]; totalArticles: number }> {
  await ensureArticleDbSchema();
  const pool = getPgPool();
  const fromDate = normalizeDate(params.fromDate);
  const toDate = normalizeDate(params.toDate);
  const limitPerDay = Math.max(1, Math.min(Math.trunc(params.limitPerDay), 200));
  const tagGroup = normalizeTagKey(params.tagGroup || "");
  const tag = normalizeTagKey(params.tag || "");
  const qualityTier = normalizeQualityTier(params.qualityTier, "high");
  const qualityThreshold = boundedScore(
    Number(params.qualityThreshold ?? Number.parseFloat(String(process.env.QUALITY_SCORE_THRESHOLD || "62"))),
    62,
  );
  const tagGroupOrNull = tagGroup || null;
  const tagOrNull = tag || null;

  const candidates =
    qualityTier === "high"
      ? await pool.query(
          `
          SELECT
            d.date,
            d.selected_at,
            d.quality_score_snapshot,
            d.rank_score,
            a.id AS article_id,
            a.source_id,
            s.name AS source_name,
            a.title,
            a.original_url,
            a.info_url,
            a.summary_raw,
            a.lead_paragraph,
            a.source_host,
            aa.quality_score,
            aa.confidence,
            aa.one_line_summary,
            aa.primary_type,
            aa.secondary_types,
            aa.tag_groups,
            COALESCE(img.image_url, '') AS image_url
          FROM daily_high_quality_articles d
          INNER JOIN articles a ON a.id = d.article_id
          INNER JOIN sources s ON s.id = a.source_id
          INNER JOIN article_analysis aa ON aa.article_id = a.id
          LEFT JOIN LATERAL (
            SELECT image_url
            FROM article_related_images
            WHERE article_id = a.id
            ORDER BY image_index ASC
            LIMIT 1
          ) img ON TRUE
          WHERE d.date BETWEEN $1::date AND $2::date
            AND aa.quality_score >= $5::double precision
            AND ($3::text IS NULL OR aa.tag_groups ? $3::text)
            AND (
              $4::text IS NULL OR
              CASE
                WHEN $3::text IS NOT NULL THEN EXISTS (
                  SELECT 1
                  FROM jsonb_array_elements_text(COALESCE(aa.tag_groups -> $3::text, '[]'::jsonb)) AS tag_item(tag)
                  WHERE tag_item.tag = $4::text
                )
                ELSE EXISTS (
                  SELECT 1
                  FROM jsonb_each(aa.tag_groups) AS kv
                  CROSS JOIN LATERAL jsonb_array_elements_text(COALESCE(kv.value, '[]'::jsonb)) AS tag_item(tag)
                  WHERE tag_item.tag = $4::text
                )
              END
            )
          ORDER BY d.date DESC, d.rank_score DESC, d.selected_at DESC
        `,
          [fromDate, toDate, tagGroupOrNull, tagOrNull, qualityThreshold],
        )
      : await pool.query(
          `
          SELECT
            d.date,
            d.analyzed_at,
            d.quality_score_snapshot,
            d.rank_score,
            a.id AS article_id,
            a.source_id,
            s.name AS source_name,
            a.title,
            a.original_url,
            a.info_url,
            a.summary_raw,
            a.lead_paragraph,
            a.source_host,
            aa.quality_score,
            aa.confidence,
            aa.one_line_summary,
            aa.primary_type,
            aa.secondary_types,
            aa.tag_groups,
            COALESCE(img.image_url, '') AS image_url
          FROM daily_analyzed_articles d
          INNER JOIN articles a ON a.id = d.article_id
          INNER JOIN sources s ON s.id = a.source_id
          INNER JOIN article_analysis aa ON aa.article_id = a.id
          LEFT JOIN LATERAL (
            SELECT image_url
            FROM article_related_images
            WHERE article_id = a.id
            ORDER BY image_index ASC
            LIMIT 1
          ) img ON TRUE
          WHERE d.date BETWEEN $1::date AND $2::date
            AND (
              $5::text = 'all'
              OR ($5::text = 'general' AND d.quality_score_snapshot < $6::double precision)
            )
            AND ($3::text IS NULL OR aa.tag_groups ? $3::text)
            AND (
              $4::text IS NULL OR
              CASE
                WHEN $3::text IS NOT NULL THEN EXISTS (
                  SELECT 1
                  FROM jsonb_array_elements_text(COALESCE(aa.tag_groups -> $3::text, '[]'::jsonb)) AS tag_item(tag)
                  WHERE tag_item.tag = $4::text
                )
                ELSE EXISTS (
                  SELECT 1
                  FROM jsonb_each(aa.tag_groups) AS kv
                  CROSS JOIN LATERAL jsonb_array_elements_text(COALESCE(kv.value, '[]'::jsonb)) AS tag_item(tag)
                  WHERE tag_item.tag = $4::text
                )
              END
            )
          ORDER BY d.date DESC, d.rank_score DESC, d.analyzed_at DESC
        `,
          [fromDate, toDate, tagGroupOrNull, tagOrNull, qualityTier, qualityThreshold],
        );

  const rows = candidates.rows.map((row) => row as Record<string, unknown>);
  if (!rows.length) {
    return {
      groups: [],
      totalArticles: 0,
    };
  }

  const articleIds = Array.from(
    new Set(
      rows
        .map((row) => String(row.article_id || "").trim())
        .filter(Boolean),
    ),
  );

  if (!articleIds.length) {
    return {
      groups: [],
      totalArticles: 0,
    };
  }

  const firstSeenRows =
    qualityTier === "high"
      ? await pool.query(
          `
          SELECT d.article_id, MIN(d.date) AS first_date
          FROM daily_high_quality_articles d
          INNER JOIN article_analysis aa ON aa.article_id = d.article_id
          WHERE d.article_id = ANY($1::text[])
            AND aa.quality_score >= $4::double precision
            AND ($2::text IS NULL OR aa.tag_groups ? $2::text)
            AND (
              $3::text IS NULL OR
              CASE
                WHEN $2::text IS NOT NULL THEN EXISTS (
                  SELECT 1
                  FROM jsonb_array_elements_text(COALESCE(aa.tag_groups -> $2::text, '[]'::jsonb)) AS tag_item(tag)
                  WHERE tag_item.tag = $3::text
                )
                ELSE EXISTS (
                  SELECT 1
                  FROM jsonb_each(aa.tag_groups) AS kv
                  CROSS JOIN LATERAL jsonb_array_elements_text(COALESCE(kv.value, '[]'::jsonb)) AS tag_item(tag)
                  WHERE tag_item.tag = $3::text
                )
              END
            )
          GROUP BY d.article_id
        `,
          [articleIds, tagGroupOrNull, tagOrNull, qualityThreshold],
        )
      : await pool.query(
          `
          SELECT d.article_id, MIN(d.date) AS first_date
          FROM daily_analyzed_articles d
          INNER JOIN article_analysis aa ON aa.article_id = d.article_id
          WHERE d.article_id = ANY($1::text[])
            AND (
              $4::text = 'all'
              OR ($4::text = 'general' AND d.quality_score_snapshot < $5::double precision)
            )
            AND ($2::text IS NULL OR aa.tag_groups ? $2::text)
            AND (
              $3::text IS NULL OR
              CASE
                WHEN $2::text IS NOT NULL THEN EXISTS (
                  SELECT 1
                  FROM jsonb_array_elements_text(COALESCE(aa.tag_groups -> $2::text, '[]'::jsonb)) AS tag_item(tag)
                  WHERE tag_item.tag = $3::text
                )
                ELSE EXISTS (
                  SELECT 1
                  FROM jsonb_each(aa.tag_groups) AS kv
                  CROSS JOIN LATERAL jsonb_array_elements_text(COALESCE(kv.value, '[]'::jsonb)) AS tag_item(tag)
                  WHERE tag_item.tag = $3::text
                )
              END
            )
          GROUP BY d.article_id
        `,
          [articleIds, tagGroupOrNull, tagOrNull, qualityTier, qualityThreshold],
        );

  const firstSeenByArticleId = new Map<string, string>();
  firstSeenRows.rows.forEach((raw) => {
    const row = raw as Record<string, unknown>;
    const articleId = String(row.article_id || "").trim();
    const firstDate = toDateString(row.first_date);
    if (!articleId || !firstDate) {
      return;
    }
    firstSeenByArticleId.set(articleId, firstDate);
  });

  return buildFirstSeenUniqueHighQualityGroups({
    rows,
    firstSeenByArticleId,
    limitPerDay,
    qualityTier,
    qualityThreshold,
  });
}

export async function listArchivedArticles(params: {
  fromDate: string;
  toDate: string;
  limit: number;
  offset: number;
  qualityTier?: string;
  qualityThreshold?: number;
  sourceId?: string;
  primaryType?: string;
  search?: string;
}): Promise<{ total: number; items: ArchivedArticleRow[] }> {
  await ensureArticleDbSchema();
  const pool = getPgPool();
  const fromDate = normalizeDate(params.fromDate);
  const toDate = normalizeDate(params.toDate);
  const limit = Math.max(1, Math.min(Math.trunc(params.limit), 200));
  const offset = Math.max(0, Math.min(Math.trunc(params.offset), 20_000));
  const qualityTier = normalizeQualityTier(params.qualityTier, "all");
  const qualityThreshold = boundedScore(
    Number(params.qualityThreshold ?? Number.parseFloat(String(process.env.QUALITY_SCORE_THRESHOLD || "62"))),
    62,
  );
  const sourceId = String(params.sourceId || "").trim() || null;
  const primaryType = normalizeTagKey(String(params.primaryType || "")) || null;
  const searchRaw = String(params.search || "").trim();
  const search = searchRaw ? searchRaw.slice(0, 160) : null;

  const totalRow = await pool.query<{ total: string | number }>(
    `
    SELECT COUNT(*) AS total
    FROM daily_analyzed_articles d
    INNER JOIN articles a ON a.id = d.article_id
    INNER JOIN sources s ON s.id = a.source_id
    INNER JOIN article_analysis aa ON aa.article_id = a.id
    WHERE d.date BETWEEN $1::date AND $2::date
      AND (
        $3::text = 'all'
        OR ($3::text = 'high' AND d.quality_score_snapshot >= $4::double precision)
        OR ($3::text = 'general' AND d.quality_score_snapshot < $4::double precision)
      )
      AND ($5::text IS NULL OR a.source_id = $5::text)
      AND ($6::text IS NULL OR aa.primary_type = $6::text)
      AND (
        $7::text IS NULL
        OR a.title ILIKE ('%' || $7 || '%')
        OR s.name ILIKE ('%' || $7 || '%')
        OR a.info_url ILIKE ('%' || $7 || '%')
        OR aa.one_line_summary ILIKE ('%' || $7 || '%')
        OR aa.reason_short ILIKE ('%' || $7 || '%')
      )
  `,
    [fromDate, toDate, qualityTier, qualityThreshold, sourceId, primaryType, search],
  );

  const rows = await pool.query(
    `
    WITH filtered AS (
      SELECT
        d.date,
        d.analyzed_at,
        d.quality_score_snapshot,
        d.rank_score,
        a.id AS article_id,
        a.source_id,
        s.name AS source_name,
        a.title,
        a.canonical_url,
        a.original_url,
        a.info_url,
        a.published_at,
        a.summary_raw,
        a.lead_paragraph,
        a.source_host,
        aa.quality_score,
        aa.confidence,
        aa.worth,
        aa.one_line_summary,
        aa.reason_short,
        aa.action_hint,
        aa.company_impact,
        aa.team_impact,
        aa.personal_impact,
        aa.execution_clarity,
        aa.novelty_score,
        aa.clarity_score,
        aa.best_for_roles,
        aa.evidence_signals,
        aa.primary_type,
        aa.secondary_types,
        aa.tag_groups,
        h.selected_at,
        (h.article_id IS NOT NULL) AS is_selected
      FROM daily_analyzed_articles d
      INNER JOIN articles a ON a.id = d.article_id
      INNER JOIN sources s ON s.id = a.source_id
      INNER JOIN article_analysis aa ON aa.article_id = a.id
      LEFT JOIN daily_high_quality_articles h
        ON h.date = d.date
       AND h.article_id = d.article_id
      WHERE d.date BETWEEN $1::date AND $2::date
        AND (
          $3::text = 'all'
          OR ($3::text = 'high' AND d.quality_score_snapshot >= $4::double precision)
          OR ($3::text = 'general' AND d.quality_score_snapshot < $4::double precision)
        )
        AND ($5::text IS NULL OR a.source_id = $5::text)
        AND ($6::text IS NULL OR aa.primary_type = $6::text)
        AND (
          $7::text IS NULL
          OR a.title ILIKE ('%' || $7 || '%')
          OR s.name ILIKE ('%' || $7 || '%')
          OR a.info_url ILIKE ('%' || $7 || '%')
          OR aa.one_line_summary ILIKE ('%' || $7 || '%')
          OR aa.reason_short ILIKE ('%' || $7 || '%')
        )
    )
    SELECT
      filtered.*,
      CASE WHEN filtered.quality_score_snapshot >= $4::double precision THEN 'high' ELSE 'general' END AS quality_tier,
      COALESCE(feedback.good_count, 0) AS feedback_good_count,
      COALESCE(feedback.bad_count, 0) AS feedback_bad_count,
      COALESCE(feedback.total_count, 0) AS feedback_total_count,
      COALESCE(feedback.last_feedback, '') AS feedback_last,
      feedback.last_feedback_at AS feedback_last_at
    FROM filtered
    LEFT JOIN LATERAL (
      SELECT
        COUNT(*) FILTER (WHERE aqf.feedback = 'good') AS good_count,
        COUNT(*) FILTER (WHERE aqf.feedback = 'bad') AS bad_count,
        COUNT(*) AS total_count,
        MAX(aqf.created_at) AS last_feedback_at,
        (
          SELECT aqf2.feedback
          FROM article_quality_feedback aqf2
          WHERE aqf2.article_id = filtered.article_id
          ORDER BY aqf2.created_at DESC
          LIMIT 1
        ) AS last_feedback
      FROM article_quality_feedback aqf
      WHERE aqf.article_id = filtered.article_id
    ) AS feedback ON TRUE
    ORDER BY filtered.date DESC, filtered.rank_score DESC, filtered.analyzed_at DESC
    LIMIT $8 OFFSET $9
  `,
    [fromDate, toDate, qualityTier, qualityThreshold, sourceId, primaryType, search, limit, offset],
  );

  return {
    total: Number(totalRow.rows[0]?.total || 0),
    items: rows.rows.map((row) => rowToArchivedArticle(row as Record<string, unknown>, qualityThreshold)),
  };
}

export async function recordArticleQualityFeedback(params: {
  articleId: string;
  feedback: string;
  source?: string;
  contextJson?: Record<string, unknown>;
}): Promise<ArticleQualityFeedbackEvent | null> {
  await ensureArticleDbSchema();
  const articleId = String(params.articleId || "").trim();
  if (!articleId) {
    throw new Error("Missing article_id");
  }
  const feedback = normalizeFeedbackValue(params.feedback);
  const feedbackScore = feedback === "good" ? 1 : -1;
  const source = String(params.source || "archive_review_ui").trim() || "archive_review_ui";
  const contextJson = params.contextJson && typeof params.contextJson === "object" ? params.contextJson : {};
  const pool = getPgPool();

  const snapshotQuery = await pool.query(
    `
    SELECT
      a.id AS article_id,
      a.source_id,
      aa.primary_type,
      aa.quality_score,
      aa.confidence,
      aa.worth,
      aa.reason_short,
      aa.action_hint,
      aa.tag_groups,
      aa.evidence_signals
    FROM articles a
    INNER JOIN article_analysis aa ON aa.article_id = a.id
    WHERE a.id = $1
    LIMIT 1
  `,
    [articleId],
  );

  if (!snapshotQuery.rows.length) {
    return null;
  }

  const snapshot = snapshotQuery.rows[0] as Record<string, unknown>;
  const id = `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  const mergedContext = {
    ...contextJson,
    source,
    article_id: articleId,
  };

  const inserted = await pool.query(
    `
    INSERT INTO article_quality_feedback (
      id,
      article_id,
      feedback,
      feedback_score,
      source_id,
      primary_type,
      quality_score_snapshot,
      confidence_snapshot,
      worth_snapshot,
      reason_short_snapshot,
      action_hint_snapshot,
      tag_groups_snapshot,
      evidence_signals_snapshot,
      context_json,
      created_at
    )
    VALUES (
      $1, $2, $3, $4, $5, $6,
      $7, $8, $9, $10, $11, $12::jsonb, $13::jsonb, $14::jsonb, NOW()
    )
    RETURNING *
  `,
    [
      id,
      articleId,
      feedback,
      feedbackScore,
      String(snapshot.source_id || ""),
      normalizeTagKey(String(snapshot.primary_type || "other")) || "other",
      Number(snapshot.quality_score || 0),
      Number(snapshot.confidence || 0),
      String(snapshot.worth || ""),
      String(snapshot.reason_short || ""),
      String(snapshot.action_hint || ""),
      JSON.stringify(parseTagGroups(snapshot.tag_groups)),
      JSON.stringify(parseStringArray(snapshot.evidence_signals)),
      JSON.stringify(mergedContext),
    ],
  );

  return parseArticleQualityFeedbackRow(inserted.rows[0] as Record<string, unknown>);
}

function boundedPositive(value: number, fallback: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, value));
}

function computeBiasMap(
  rows: Array<Record<string, unknown>>,
  params: {
    keyField: string;
    weight: number;
    minSamples: number;
    maxAbs: number;
    normalizeKey?: (value: string) => string;
  },
): Record<string, number> {
  const output: Record<string, number> = {};
  rows.forEach((row) => {
    const rawKey = String(row[params.keyField] || "").trim();
    const key = params.normalizeKey ? params.normalizeKey(rawKey) : rawKey;
    if (!key) return;
    const avg = Number(row.avg_score || 0);
    const count = Number(row.sample_count || 0);
    if (!Number.isFinite(avg) || count <= 0) return;
    const confidenceScale = Math.min(1, count / Math.max(1, params.minSamples));
    const rawBias = avg * params.weight * confidenceScale;
    const rounded = Number(rawBias.toFixed(4));
    if (!Number.isFinite(rounded) || rounded === 0) return;
    output[key] = Math.max(-params.maxAbs, Math.min(params.maxAbs, rounded));
  });
  return output;
}

export async function loadFeedbackAdjustmentMap(params: {
  lookbackDays?: number;
  articleWeight?: number;
  sourceWeight?: number;
  typeWeight?: number;
  articleMinSamples?: number;
  sourceMinSamples?: number;
  typeMinSamples?: number;
  articleMaxAbs?: number;
  sourceMaxAbs?: number;
  typeMaxAbs?: number;
} = {}): Promise<FeedbackAdjustmentMap> {
  await ensureArticleDbSchema();
  const lookbackDays = Math.max(1, Math.min(365, Math.trunc(params.lookbackDays ?? 120)));
  const articleWeight = boundedPositive(Number(params.articleWeight ?? 6), 6, 0, 20);
  const sourceWeight = boundedPositive(Number(params.sourceWeight ?? 3), 3, 0, 20);
  const typeWeight = boundedPositive(Number(params.typeWeight ?? 2), 2, 0, 20);
  const articleMinSamples = Math.max(1, Math.min(1000, Math.trunc(params.articleMinSamples ?? 3)));
  const sourceMinSamples = Math.max(1, Math.min(1000, Math.trunc(params.sourceMinSamples ?? 6)));
  const typeMinSamples = Math.max(1, Math.min(1000, Math.trunc(params.typeMinSamples ?? 8)));
  const articleMaxAbs = boundedPositive(Number(params.articleMaxAbs ?? 10), 10, 0, 30);
  const sourceMaxAbs = boundedPositive(Number(params.sourceMaxAbs ?? 6), 6, 0, 30);
  const typeMaxAbs = boundedPositive(Number(params.typeMaxAbs ?? 5), 5, 0, 30);

  const pool = getPgPool();

  const [sampleRow, articleRows, sourceRows, typeRows] = await Promise.all([
    pool.query<{ sample_count: string | number }>(
      `
      SELECT COUNT(*) AS sample_count
      FROM article_quality_feedback
      WHERE created_at >= NOW() - make_interval(days => $1::int)
    `,
      [lookbackDays],
    ),
    pool.query(
      `
      SELECT
        article_id,
        AVG(feedback_score) AS avg_score,
        COUNT(*) AS sample_count
      FROM article_quality_feedback
      WHERE created_at >= NOW() - make_interval(days => $1::int)
      GROUP BY article_id
    `,
      [lookbackDays],
    ),
    pool.query(
      `
      SELECT
        source_id,
        AVG(feedback_score) AS avg_score,
        COUNT(*) AS sample_count
      FROM article_quality_feedback
      WHERE created_at >= NOW() - make_interval(days => $1::int)
      GROUP BY source_id
    `,
      [lookbackDays],
    ),
    pool.query(
      `
      SELECT
        primary_type,
        AVG(feedback_score) AS avg_score,
        COUNT(*) AS sample_count
      FROM article_quality_feedback
      WHERE created_at >= NOW() - make_interval(days => $1::int)
      GROUP BY primary_type
    `,
      [lookbackDays],
    ),
  ]);

  return {
    lookback_days: lookbackDays,
    sample_count: Number(sampleRow.rows[0]?.sample_count || 0),
    article_bias: computeBiasMap(articleRows.rows as Array<Record<string, unknown>>, {
      keyField: "article_id",
      weight: articleWeight,
      minSamples: articleMinSamples,
      maxAbs: articleMaxAbs,
    }),
    source_bias: computeBiasMap(sourceRows.rows as Array<Record<string, unknown>>, {
      keyField: "source_id",
      weight: sourceWeight,
      minSamples: sourceMinSamples,
      maxAbs: sourceMaxAbs,
    }),
    type_bias: computeBiasMap(typeRows.rows as Array<Record<string, unknown>>, {
      keyField: "primary_type",
      weight: typeWeight,
      minSamples: typeMinSamples,
      maxAbs: typeMaxAbs,
      normalizeKey: (value) => normalizeTagKey(value),
    }),
  };
}

export async function getHighQualityArticleDetail(articleId: string): Promise<HighQualityArticleDetail | null> {
  await ensureArticleDbSchema();
  const normalized = String(articleId || "").trim();
  if (!normalized) return null;

  const pool = getPgPool();
  const result = await pool.query(
    `
    SELECT
      a.id AS article_id,
      a.source_id,
      s.name AS source_name,
      a.title,
      a.canonical_url,
      a.original_url,
      a.info_url,
      a.published_at,
      a.summary_raw,
      a.lead_paragraph,
      a.content_text,
      a.content_full_text,
      a.content_full_html,
      a.content_full_source_url,
      a.content_full_updated_at,
      a.content_full_error,
      a.source_host,
      aa.quality_score,
      aa.confidence,
      aa.worth,
      aa.one_line_summary,
      aa.reason_short,
      aa.action_hint,
      aa.company_impact,
      aa.team_impact,
      aa.personal_impact,
      aa.execution_clarity,
      aa.novelty_score,
      aa.clarity_score,
      aa.best_for_roles,
      aa.evidence_signals,
      aa.primary_type,
      aa.secondary_types,
      aa.tag_groups,
      aa.analyzed_at,
      COALESCE(img.related_images, '[]'::json) AS related_images
    FROM articles a
    INNER JOIN sources s ON s.id = a.source_id
    INNER JOIN article_analysis aa ON aa.article_id = a.id
    LEFT JOIN LATERAL (
      SELECT json_agg(
        json_build_object(
          'image_index', ari.image_index,
          'image_url', ari.image_url,
          'alt_text', ari.alt_text
        )
        ORDER BY ari.image_index ASC
      ) AS related_images
      FROM article_related_images ari
      WHERE ari.article_id = a.id
    ) img ON TRUE
    WHERE a.id = $1
    LIMIT 1
  `,
    [normalized],
  );

  if (!result.rows.length) return null;

  const dateRows = await pool.query(
    `
    SELECT date
    FROM daily_high_quality_articles
    WHERE article_id = $1
    ORDER BY date DESC
    LIMIT 30
  `,
    [normalized],
  );

  const row = result.rows[0] as Record<string, unknown>;

  return {
    article_id: String(row.article_id || ""),
    source_id: String(row.source_id || ""),
    source_name: String(row.source_name || ""),
    title: String(row.title || ""),
    canonical_url: String(row.canonical_url || ""),
    original_url: String(row.original_url || ""),
    info_url: String(row.info_url || ""),
    published_at: toIso(row.published_at),
    summary_raw: String(row.summary_raw || ""),
    lead_paragraph: String(row.lead_paragraph || ""),
    content_text: String(row.content_text || ""),
    content_full_text: String(row.content_full_text || ""),
    content_full_html: String(row.content_full_html || ""),
    content_full_source_url: String(row.content_full_source_url || ""),
    content_full_updated_at: toIso(row.content_full_updated_at),
    content_full_error: String(row.content_full_error || ""),
    related_images: parsePersistedArticleImages(row.related_images),
    source_host: String(row.source_host || ""),
    quality_score: Number(row.quality_score || 0),
    confidence: Number(row.confidence || 0),
    worth: String(row.worth || ""),
    one_line_summary: String(row.one_line_summary || ""),
    reason_short: String(row.reason_short || ""),
    action_hint: String(row.action_hint || ""),
    company_impact: Number(row.company_impact || 0),
    team_impact: Number(row.team_impact || 0),
    personal_impact: Number(row.personal_impact || 0),
    execution_clarity: Number(row.execution_clarity || 0),
    novelty_score: Number(row.novelty_score || 0),
    clarity_score: Number(row.clarity_score || 0),
    best_for_roles: parseStringArray(row.best_for_roles),
    evidence_signals: parseStringArray(row.evidence_signals),
    primary_type: String(row.primary_type || "other"),
    secondary_types: parseStringArray(row.secondary_types),
    tag_groups: parseTagGroups(row.tag_groups),
    analyzed_at: toIso(row.analyzed_at),
    selected_dates: dateRows.rows.map((item) => toDateString(item.date)),
  };
}

export async function countDailyHighQuality(date: string): Promise<number> {
  await ensureArticleDbSchema();
  const normalizedDate = normalizeDate(date);
  const pool = getPgPool();
  const row = await pool.query<{ total: string | number }>(
    `SELECT COUNT(*) AS total FROM daily_high_quality_articles WHERE date = $1::date`,
    [normalizedDate],
  );
  return Number(row.rows[0]?.total || 0);
}

export async function countDailyAnalyzed(date: string): Promise<number> {
  await ensureArticleDbSchema();
  const normalizedDate = normalizeDate(date);
  const pool = getPgPool();
  const row = await pool.query<{ total: string | number }>(
    `SELECT COUNT(*) AS total FROM daily_analyzed_articles WHERE date = $1::date`,
    [normalizedDate],
  );
  return Number(row.rows[0]?.total || 0);
}

export async function listTagGroups(): Promise<TagGroupRow[]> {
  await ensureArticleDbSchema();
  const pool = getPgPool();
  const rows = await pool.query(
    `
    SELECT
      group_key,
      tag_key,
      display_name,
      description,
      aliases,
      is_active,
      managed_by,
      updated_at
    FROM tag_registry
    ORDER BY group_key ASC, is_active DESC, tag_key ASC
  `,
  );

  const grouped = new Map<string, TagDefinition[]>();
  rows.rows.forEach((raw) => {
    const row = raw as Record<string, unknown>;
    const groupKey = normalizeTagKey(String(row.group_key || ""));
    const tagKey = normalizeTagKey(String(row.tag_key || ""));
    if (!groupKey || !tagKey) return;
    const bucket = grouped.get(groupKey) || [];
    bucket.push({
      group_key: groupKey,
      tag_key: tagKey,
      display_name: String(row.display_name || tagKey),
      description: String(row.description || ""),
      aliases: parseStringArray(row.aliases),
      is_active: Boolean(row.is_active),
      managed_by: String(row.managed_by || "ai"),
      updated_at: toIso(row.updated_at),
    });
    grouped.set(groupKey, bucket);
  });

  return Array.from(grouped.entries())
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([group_key, tags]) => ({
      group_key,
      tags,
    }));
}

export async function listActiveTagDefinitions(): Promise<TagDefinition[]> {
  await ensureArticleDbSchema();
  const pool = getPgPool();
  const result = await pool.query(
    `
    SELECT
      group_key,
      tag_key,
      display_name,
      description,
      aliases,
      is_active,
      managed_by,
      updated_at
    FROM tag_registry
    WHERE is_active = TRUE
    ORDER BY group_key ASC, tag_key ASC
  `,
  );

  const items: TagDefinition[] = [];
  result.rows.forEach((raw) => {
    const row = raw as Record<string, unknown>;
    const groupKey = normalizeTagKey(String(row.group_key || ""));
    const tagKey = normalizeTagKey(String(row.tag_key || ""));
    if (!groupKey || !tagKey) return;
    items.push({
      group_key: groupKey,
      tag_key: tagKey,
      display_name: String(row.display_name || tagKey),
      description: String(row.description || ""),
      aliases: parseStringArray(row.aliases),
      is_active: Boolean(row.is_active),
      managed_by: String(row.managed_by || "ai"),
      updated_at: toIso(row.updated_at),
    });
  });
  return items;
}

export async function getTagDefinition(groupKeyRaw: string, tagKeyRaw: string): Promise<TagDefinition | null> {
  await ensureArticleDbSchema();
  const groupKey = normalizeTagKey(groupKeyRaw);
  const tagKey = normalizeTagKey(tagKeyRaw);
  if (!groupKey || !tagKey) return null;
  const pool = getPgPool();
  const result = await pool.query(
    `
    SELECT
      group_key,
      tag_key,
      display_name,
      description,
      aliases,
      is_active,
      managed_by,
      updated_at
    FROM tag_registry
    WHERE group_key = $1 AND tag_key = $2
    LIMIT 1
  `,
    [groupKey, tagKey],
  );
  if (!result.rows.length) return null;
  const row = result.rows[0] as Record<string, unknown>;
  return {
    group_key: String(row.group_key || groupKey),
    tag_key: String(row.tag_key || tagKey),
    display_name: String(row.display_name || tagKey),
    description: String(row.description || ""),
    aliases: parseStringArray(row.aliases),
    is_active: Boolean(row.is_active),
    managed_by: String(row.managed_by || "ai"),
    updated_at: toIso(row.updated_at),
  };
}

export async function listTagUsageStats(params: {
  lookbackDays: number;
  groupKeys?: string[];
  limit?: number;
}): Promise<TagUsageStat[]> {
  await ensureArticleDbSchema();
  const lookbackDays = Math.max(1, Math.min(180, Math.trunc(params.lookbackDays || 30)));
  const normalizedGroups = Array.from(
    new Set((params.groupKeys || []).map((item) => normalizeTagKey(item)).filter(Boolean)),
  );
  const limit = Math.max(20, Math.min(2000, Math.trunc(params.limit || 800)));
  const groupFilter = normalizedGroups.length ? normalizedGroups : null;

  const pool = getPgPool();
  const result = await pool.query(
    `
    WITH exploded AS (
      SELECT
        kv.key AS group_key,
        tag_item.tag AS tag_key,
        aa.quality_score,
        aa.analyzed_at
      FROM article_analysis aa
      CROSS JOIN LATERAL jsonb_each(COALESCE(aa.tag_groups, '{}'::jsonb)) AS kv
      CROSS JOIN LATERAL jsonb_array_elements_text(COALESCE(kv.value, '[]'::jsonb)) AS tag_item(tag)
      WHERE aa.analyzed_at >= NOW() - make_interval(days => $1::int)
        AND ($2::text[] IS NULL OR kv.key = ANY($2))
    )
    SELECT
      group_key,
      tag_key,
      COUNT(*) AS use_count,
      AVG(quality_score) AS avg_quality,
      MAX(analyzed_at) AS last_seen
    FROM exploded
    GROUP BY group_key, tag_key
    ORDER BY use_count DESC, avg_quality DESC, last_seen DESC
    LIMIT $3
  `,
    [lookbackDays, groupFilter, limit],
  );

  return result.rows.map((raw) => {
    const row = raw as Record<string, unknown>;
    return {
      group_key: normalizeTagKey(String(row.group_key || "")),
      tag_key: normalizeTagKey(String(row.tag_key || "")),
      use_count: Number(row.use_count || 0),
      avg_quality: Number(row.avg_quality || 0),
      last_seen: toIso(row.last_seen),
    };
  });
}

export async function upsertTagDefinition(params: {
  groupKey: string;
  tagKey: string;
  displayName: string;
  description?: string;
  aliases?: string[];
  isActive?: boolean;
  managedBy?: string;
}): Promise<void> {
  await ensureArticleDbSchema();
  const groupKey = normalizeTagKey(params.groupKey);
  const tagKey = normalizeTagKey(params.tagKey);
  if (!groupKey || !tagKey) {
    throw new Error("Invalid group_key or tag_key");
  }

  const displayName = String(params.displayName || tagKey).trim() || tagKey;
  const description = String(params.description || "").trim();
  const aliases = Array.from(
    new Set(
      (params.aliases || [])
        .map((item) => normalizeTagKey(String(item || "")))
        .filter(Boolean),
    ),
  );
  const isActive = params.isActive !== undefined ? Boolean(params.isActive) : true;
  const managedBy = String(params.managedBy || "ai").trim() || "ai";

  const pool = getPgPool();
  await pool.query(
    `
    INSERT INTO tag_registry (
      group_key,
      tag_key,
      display_name,
      description,
      aliases,
      is_active,
      managed_by,
      updated_at
    )
    VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, NOW())
    ON CONFLICT (group_key, tag_key)
    DO UPDATE SET
      display_name = EXCLUDED.display_name,
      description = EXCLUDED.description,
      aliases = EXCLUDED.aliases,
      is_active = EXCLUDED.is_active,
      managed_by = EXCLUDED.managed_by,
      updated_at = NOW()
  `,
    [groupKey, tagKey, displayName, description, JSON.stringify(aliases), isActive, managedBy],
  );
}

export async function deactivateTagDefinition(groupKeyRaw: string, tagKeyRaw: string): Promise<boolean> {
  await ensureArticleDbSchema();
  const groupKey = normalizeTagKey(groupKeyRaw);
  const tagKey = normalizeTagKey(tagKeyRaw);
  if (!groupKey || !tagKey) {
    return false;
  }
  const pool = getPgPool();
  const result = await pool.query(
    `
    UPDATE tag_registry
    SET is_active = FALSE, updated_at = NOW()
    WHERE group_key = $1 AND tag_key = $2
  `,
    [groupKey, tagKey],
  );
  return Number(result.rowCount || 0) > 0;
}

export async function replaceTagInAnalysisTagGroups(
  groupKeyRaw: string,
  sourceTagRaw: string,
  targetTagRaw: string,
): Promise<number> {
  await ensureArticleDbSchema();
  const groupKey = normalizeTagKey(groupKeyRaw);
  const sourceTag = normalizeTagKey(sourceTagRaw);
  const targetTag = normalizeTagKey(targetTagRaw);
  if (!groupKey || !sourceTag || !targetTag || sourceTag === targetTag) {
    return 0;
  }

  const pool = getPgPool();
  const scan = await pool.query(
    `
    SELECT article_id, tag_groups
    FROM article_analysis
    WHERE tag_groups ? $1::text
      AND EXISTS (
        SELECT 1
        FROM jsonb_array_elements_text(COALESCE(tag_groups -> $1::text, '[]'::jsonb)) AS tag_item(tag)
        WHERE tag_item.tag = $2::text
      )
  `,
    [groupKey, sourceTag],
  );

  if (!scan.rows.length) {
    return 0;
  }

  let updatedCount = 0;
  await withTx(async (client) => {
    for (const raw of scan.rows) {
      const row = raw as Record<string, unknown>;
      const articleId = String(row.article_id || "").trim();
      if (!articleId) continue;
      const groups = parseTagGroups(row.tag_groups);
      const tags = groups[groupKey] || [];
      if (!tags.includes(sourceTag)) continue;
      const next = Array.from(new Set(tags.map((item) => (item === sourceTag ? targetTag : item)).filter(Boolean)));
      groups[groupKey] = next;
      await client.query(
        `
        UPDATE article_analysis
        SET tag_groups = $2::jsonb, analyzed_at = NOW()
        WHERE article_id = $1
      `,
        [articleId, JSON.stringify(groups)],
      );
      updatedCount += 1;
    }
  });

  return updatedCount;
}

export async function getTagGovernanceObjective(objectiveIdRaw = "default"): Promise<TagGovernanceObjectiveRow> {
  await ensureArticleDbSchema();
  const objectiveId = String(objectiveIdRaw || "default").trim() || "default";
  const pool = getPgPool();
  const result = await pool.query(
    `
    SELECT objective_id, config_json, updated_at
    FROM tag_governance_objectives
    WHERE objective_id = $1
    LIMIT 1
  `,
    [objectiveId],
  );
  if (!result.rows.length) {
    return {
      objective_id: objectiveId,
      config_json: {},
      updated_at: "",
    };
  }
  return parseGovernanceObjectiveRow(result.rows[0] as Record<string, unknown>);
}

export async function upsertTagGovernanceObjective(params: {
  objectiveId: string;
  configJson: Record<string, unknown>;
}): Promise<TagGovernanceObjectiveRow> {
  await ensureArticleDbSchema();
  const objectiveId = String(params.objectiveId || "default").trim() || "default";
  const configJson = params.configJson && typeof params.configJson === "object" ? params.configJson : {};
  const pool = getPgPool();
  const result = await pool.query(
    `
    INSERT INTO tag_governance_objectives (objective_id, config_json, updated_at)
    VALUES ($1, $2::jsonb, NOW())
    ON CONFLICT (objective_id)
    DO UPDATE SET
      config_json = EXCLUDED.config_json,
      updated_at = NOW()
    RETURNING objective_id, config_json, updated_at
  `,
    [objectiveId, JSON.stringify(configJson)],
  );
  return parseGovernanceObjectiveRow(result.rows[0] as Record<string, unknown>);
}

export async function createTagGovernanceRun(params: {
  objectiveId: string;
  dryRun: boolean;
  requestJson?: Record<string, unknown>;
}): Promise<string> {
  await ensureArticleDbSchema();
  const objectiveId = String(params.objectiveId || "default").trim() || "default";
  const runId = `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  const pool = getPgPool();
  await pool.query(
    `
    INSERT INTO tag_governance_runs (id, objective_id, status, dry_run, started_at, request_json)
    VALUES ($1, $2, 'running', $3, NOW(), $4::jsonb)
  `,
    [runId, objectiveId, Boolean(params.dryRun), JSON.stringify(params.requestJson || {})],
  );
  return runId;
}

export async function finishTagGovernanceRun(params: {
  runId: string;
  status: "success" | "failed";
  contextJson?: Record<string, unknown>;
  plannerJson?: Record<string, unknown>;
  criticJson?: Record<string, unknown>;
  appliedJson?: Record<string, unknown>;
  errorMessage?: string;
}): Promise<void> {
  await ensureArticleDbSchema();
  const pool = getPgPool();
  await pool.query(
    `
    UPDATE tag_governance_runs
    SET
      status = $2,
      finished_at = NOW(),
      context_json = $3::jsonb,
      planner_json = $4::jsonb,
      critic_json = $5::jsonb,
      applied_json = $6::jsonb,
      error_message = $7
    WHERE id = $1
  `,
    [
      params.runId,
      params.status,
      JSON.stringify(params.contextJson || {}),
      JSON.stringify(params.plannerJson || {}),
      JSON.stringify(params.criticJson || {}),
      JSON.stringify(params.appliedJson || {}),
      String(params.errorMessage || ""),
    ],
  );
}

export async function getTagGovernanceRun(runId: string): Promise<TagGovernanceRunRow | null> {
  await ensureArticleDbSchema();
  const normalized = String(runId || "").trim();
  if (!normalized) return null;
  const pool = getPgPool();
  const result = await pool.query(
    `
    SELECT *
    FROM tag_governance_runs
    WHERE id = $1
    LIMIT 1
  `,
    [normalized],
  );
  if (!result.rows.length) return null;
  return parseGovernanceRunRow(result.rows[0] as Record<string, unknown>);
}

export async function appendTagGovernanceFeedback(params: {
  objectiveId?: string;
  eventType: string;
  groupKey?: string;
  tagKey?: string;
  score?: number;
  weight?: number;
  source?: string;
  contextJson?: Record<string, unknown>;
}): Promise<TagGovernanceFeedbackEvent> {
  await ensureArticleDbSchema();
  const objectiveId = String(params.objectiveId || "default").trim() || "default";
  const eventType = normalizeTagKey(String(params.eventType || ""));
  if (!eventType) {
    throw new Error("Invalid event_type");
  }
  const groupKey = normalizeTagKey(String(params.groupKey || ""));
  const tagKey = normalizeTagKey(String(params.tagKey || ""));
  const score = Number.isFinite(Number(params.score)) ? Number(params.score) : 0;
  const weightRaw = Number(params.weight);
  const weight = Number.isFinite(weightRaw) ? Math.max(0, weightRaw) : 1;
  const source = String(params.source || "unknown").trim() || "unknown";
  const contextJson = params.contextJson && typeof params.contextJson === "object" ? params.contextJson : {};
  const id = `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

  const pool = getPgPool();
  const result = await pool.query(
    `
    INSERT INTO tag_governance_feedback (
      id,
      objective_id,
      event_type,
      group_key,
      tag_key,
      score,
      weight,
      source,
      context_json,
      created_at
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, NOW())
    RETURNING *
  `,
    [id, objectiveId, eventType, groupKey, tagKey, score, weight, source, JSON.stringify(contextJson)],
  );

  return parseGovernanceFeedbackEventRow(result.rows[0] as Record<string, unknown>);
}

export async function listTagGovernanceFeedbackStats(params: {
  objectiveId?: string;
  days?: number;
  limit?: number;
}): Promise<TagGovernanceFeedbackStat[]> {
  await ensureArticleDbSchema();
  const objectiveId = String(params.objectiveId || "default").trim() || "default";
  const days = Math.max(1, Math.min(365, Math.trunc(params.days || 30)));
  const limit = Math.max(10, Math.min(2000, Math.trunc(params.limit || 500)));

  const pool = getPgPool();
  const result = await pool.query(
    `
    SELECT
      objective_id,
      event_type,
      group_key,
      tag_key,
      COUNT(*) AS event_count,
      AVG(score) AS avg_score,
      SUM(weight) AS total_weight,
      MAX(created_at) AS last_seen
    FROM tag_governance_feedback
    WHERE objective_id = $1
      AND created_at >= NOW() - make_interval(days => $2::int)
    GROUP BY objective_id, event_type, group_key, tag_key
    ORDER BY total_weight DESC, event_count DESC, avg_score DESC, last_seen DESC
    LIMIT $3
  `,
    [objectiveId, days, limit],
  );

  return result.rows.map((raw) => {
    const row = raw as Record<string, unknown>;
    return {
      objective_id: String(row.objective_id || objectiveId),
      event_type: String(row.event_type || ""),
      group_key: normalizeTagKey(String(row.group_key || "")),
      tag_key: normalizeTagKey(String(row.tag_key || "")),
      event_count: Number(row.event_count || 0),
      avg_score: Number(row.avg_score || 0),
      total_weight: Number(row.total_weight || 0),
      last_seen: toIso(row.last_seen),
    };
  });
}

export async function getLatestIngestionRunByDate(date: string): Promise<IngestionRunRow | null> {
  await ensureArticleDbSchema();
  const normalizedDate = normalizeDate(date);
  const pool = getPgPool();
  const result = await pool.query(
    `
    SELECT *
    FROM ingestion_runs
    WHERE run_date = $1::date
    ORDER BY started_at DESC
    LIMIT 1
  `,
    [normalizedDate],
  );
  if (!result.rows.length) return null;
  return parseRunRow(result.rows[0] as Record<string, unknown>);
}
