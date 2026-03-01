export type QualityTier = "high" | "general" | "all";
export type ArticleQualityFeedback = "good" | "bad";

export interface HighQualityArticleItem {
  article_id: string;
  title: string;
  url: string;
  summary: string;
  image_url: string;
  source_host: string;
  source_id: string;
  source_name: string;
  date: string;
  digest_id: string;
  generated_at: string;
  quality_score: number;
  quality_tier: QualityTier;
  confidence: number;
  primary_type: string;
  secondary_types: string[];
  tag_groups: Record<string, string[]>;
}

export interface HighQualityArticleGroup {
  date: string;
  items: HighQualityArticleItem[];
}

export interface HighQualityArticleDetail {
  article_id: string;
  source_id: string;
  source_name: string;
  title: string;
  canonical_url: string;
  original_url: string;
  info_url: string;
  published_at: string;
  summary_raw: string;
  lead_paragraph: string;
  content_text: string;
  content_full_text: string;
  content_full_html: string;
  content_full_source_url: string;
  content_full_updated_at: string;
  content_full_error: string;
  related_images: Array<{
    image_index: number;
    image_url: string;
    alt_text: string;
  }>;
  source_host: string;
  quality_score: number;
  confidence: number;
  worth: string;
  one_line_summary: string;
  reason_short: string;
  action_hint: string;
  company_impact: number;
  team_impact: number;
  personal_impact: number;
  execution_clarity: number;
  novelty_score: number;
  clarity_score: number;
  best_for_roles: string[];
  evidence_signals: string[];
  primary_type: string;
  secondary_types: string[];
  tag_groups: Record<string, string[]>;
  analyzed_at: string;
  selected_dates: string[];
}

export interface PersistedArticleImage {
  image_index: number;
  image_url: string;
  alt_text: string;
}

export interface ArticleContentSnapshot {
  article_id: string;
  source_url: string;
  resolved_url: string;
  content_text: string;
  content_html: string;
  content_error?: string;
  images: PersistedArticleImage[];
}

export interface ArchivedArticleRow {
  article_id: string;
  date: string;
  analyzed_at: string;
  selected_at: string;
  is_selected: boolean;
  source_id: string;
  source_name: string;
  source_host: string;
  title: string;
  canonical_url: string;
  original_url: string;
  info_url: string;
  published_at: string;
  summary_raw: string;
  lead_paragraph: string;
  quality_score_snapshot: number;
  rank_score: number;
  quality_score: number;
  confidence: number;
  worth: string;
  one_line_summary: string;
  reason_short: string;
  action_hint: string;
  company_impact: number;
  team_impact: number;
  personal_impact: number;
  execution_clarity: number;
  novelty_score: number;
  clarity_score: number;
  best_for_roles: string[];
  evidence_signals: string[];
  primary_type: string;
  secondary_types: string[];
  tag_groups: Record<string, string[]>;
  quality_tier: QualityTier;
  feedback_good_count: number;
  feedback_bad_count: number;
  feedback_total_count: number;
  feedback_last: string;
  feedback_last_at: string;
}

export interface ArticleQualityFeedbackEvent {
  id: string;
  article_id: string;
  feedback: ArticleQualityFeedback;
  feedback_score: number;
  source_id: string;
  primary_type: string;
  quality_score_snapshot: number;
  confidence_snapshot: number;
  worth_snapshot: string;
  reason_short_snapshot: string;
  action_hint_snapshot: string;
  tag_groups_snapshot: Record<string, string[]>;
  evidence_signals_snapshot: string[];
  context_json: Record<string, unknown>;
  created_at: string;
}

export interface FeedbackAdjustmentMap {
  lookback_days: number;
  sample_count: number;
  article_bias: Record<string, number>;
  source_bias: Record<string, number>;
  type_bias: Record<string, number>;
}

export interface TagDefinition {
  group_key: string;
  tag_key: string;
  display_name: string;
  description: string;
  aliases: string[];
  is_active: boolean;
  managed_by: string;
  updated_at: string;
}

export interface TagGroupRow {
  group_key: string;
  tags: TagDefinition[];
}

export interface TagUsageStat {
  group_key: string;
  tag_key: string;
  use_count: number;
  avg_quality: number;
  last_seen: string;
}

export interface TagGovernanceObjectiveRow {
  objective_id: string;
  config_json: Record<string, unknown>;
  updated_at: string;
}

export type TagGovernanceActionType =
  | "create_canonical"
  | "update_tag"
  | "add_alias"
  | "merge"
  | "deprecate"
  | "reactivate";

export interface TagGovernanceAction {
  type: TagGovernanceActionType;
  group_key: string;
  tag_key: string;
  target_tag_key?: string;
  display_name?: string;
  description?: string;
  aliases?: string[];
  managed_by?: string;
  reason?: string;
  confidence?: number;
}

export interface TagGovernanceRunRow {
  id: string;
  objective_id: string;
  status: string;
  dry_run: boolean;
  started_at: string;
  finished_at: string;
  request_json: Record<string, unknown>;
  context_json: Record<string, unknown>;
  planner_json: Record<string, unknown>;
  critic_json: Record<string, unknown>;
  applied_json: Record<string, unknown>;
  error_message: string;
}

export interface TagGovernanceFeedbackEvent {
  id: string;
  objective_id: string;
  event_type: string;
  group_key: string;
  tag_key: string;
  score: number;
  weight: number;
  source: string;
  context_json: Record<string, unknown>;
  created_at: string;
}

export interface TagGovernanceFeedbackStat {
  objective_id: string;
  event_type: string;
  group_key: string;
  tag_key: string;
  event_count: number;
  avg_score: number;
  total_weight: number;
  last_seen: string;
}

export interface IngestionRunRow {
  id: string;
  run_date: string;
  status: string;
  started_at: string;
  heartbeat_at: string;
  finished_at: string;
  fetched_count: number;
  deduped_count: number;
  analyzed_count: number;
  selected_count: number;
  error_message: string;
  stats_json: Record<string, unknown>;
}
