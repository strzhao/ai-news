import { LRUCache } from "lru-cache";
import { ArticleAssessment, SourceQualityScore } from "@/lib/domain/models";
import { buildUpstashClientOrNone, UpstashClient } from "@/lib/infra/upstash";

const ASSESSMENT_KEY_PREFIX = "cache:article_assessment";
const ASSESSMENT_INDEX_KEY = "cache:article_assessment:index";
const SOURCE_STATS_KEY = "cache:source_stats";
const REPORT_COUNTS_KEY = "cache:report_article_counts";

function nowIso(): string {
  return new Date().toISOString();
}

function parseAssessment(cacheKey: string, payloadText: string): ArticleAssessment {
  const payload = JSON.parse(payloadText || "{}");
  return {
    articleId: String(payload.article_id || ""),
    worth: String(payload.worth || "跳过") as ArticleAssessment["worth"],
    qualityScore: Number(payload.quality_score || 0),
    practicalityScore: Number(payload.practicality_score || 0),
    actionabilityScore: Number(payload.actionability_score || 0),
    noveltyScore: Number(payload.novelty_score || 0),
    clarityScore: Number(payload.clarity_score || 0),
    oneLineSummary: String(payload.one_line_summary || ""),
    reasonShort: String(payload.reason_short || ""),
    companyImpact: Number(payload.company_impact || 0),
    teamImpact: Number(payload.team_impact || 0),
    personalImpact: Number(payload.personal_impact || 0),
    executionClarity: Number(payload.execution_clarity || 0),
    actionHint: String(payload.action_hint || ""),
    bestForRoles: Array.isArray(payload.best_for_roles) ? payload.best_for_roles.map((item: unknown) => String(item)) : [],
    evidenceSignals: Array.isArray(payload.evidence_signals)
      ? payload.evidence_signals.map((item: unknown) => String(item))
      : [],
    confidence: Number(payload.confidence || 0),
    primaryType: String(payload.primary_type || "other"),
    secondaryTypes: Array.isArray(payload.secondary_types)
      ? payload.secondary_types.map((item: unknown) => String(item)).filter(Boolean)
      : [],
    cacheKey,
  };
}

export class ArticleEvalCache {
  private readonly upstash: UpstashClient | null;

  private readonly memory: LRUCache<string, ArticleAssessment>;

  constructor() {
    this.upstash = buildUpstashClientOrNone();
    this.memory = new LRUCache<string, ArticleAssessment>({ max: 2000 });
  }

  async getAssessment(cacheKey: string): Promise<ArticleAssessment | null> {
    const cached = this.memory.get(cacheKey);
    if (cached) {
      return { ...cached, cacheKey };
    }

    if (!this.upstash) return null;
    const row = await this.upstash.hgetall(`${ASSESSMENT_KEY_PREFIX}:${cacheKey}`);
    const payloadJson = row.payload_json || "";
    if (!payloadJson) return null;

    try {
      const assessment = parseAssessment(cacheKey, payloadJson);
      this.memory.set(cacheKey, assessment);
      return assessment;
    } catch {
      return null;
    }
  }

  async setAssessment(params: {
    cacheKey: string;
    sourceId: string;
    articleId: string;
    contentHash: string;
    modelName: string;
    promptVersion: string;
    assessment: ArticleAssessment;
  }): Promise<void> {
    const payload = {
      article_id: params.assessment.articleId,
      worth: params.assessment.worth,
      quality_score: params.assessment.qualityScore,
      practicality_score: params.assessment.practicalityScore,
      actionability_score: params.assessment.actionabilityScore,
      novelty_score: params.assessment.noveltyScore,
      clarity_score: params.assessment.clarityScore,
      one_line_summary: params.assessment.oneLineSummary,
      reason_short: params.assessment.reasonShort,
      company_impact: params.assessment.companyImpact,
      team_impact: params.assessment.teamImpact,
      personal_impact: params.assessment.personalImpact,
      execution_clarity: params.assessment.executionClarity,
      action_hint: params.assessment.actionHint,
      best_for_roles: params.assessment.bestForRoles,
      evidence_signals: params.assessment.evidenceSignals,
      confidence: params.assessment.confidence,
      primary_type: params.assessment.primaryType,
      secondary_types: params.assessment.secondaryTypes,
    };

    this.memory.set(params.cacheKey, {
      ...params.assessment,
      cacheKey: params.cacheKey,
    });

    if (!this.upstash) return;

    const updatedAt = nowIso();
    await this.upstash.hset(`${ASSESSMENT_KEY_PREFIX}:${params.cacheKey}`, {
      cache_key: params.cacheKey,
      source_id: params.sourceId,
      article_id: params.articleId,
      content_hash: params.contentHash,
      model_name: params.modelName,
      prompt_version: params.promptVersion,
      payload_json: JSON.stringify(payload),
      updated_at: updatedAt,
    });
    await this.upstash.zadd(ASSESSMENT_INDEX_KEY, Date.now(), params.cacheKey);
  }

  async prune(maxRows = 5000): Promise<void> {
    if (!this.upstash) return;
    const rawCount = await this.upstash.command(["ZCARD", ASSESSMENT_INDEX_KEY]);
    const total = Number(rawCount || 0);
    if (!Number.isFinite(total) || total <= maxRows) {
      return;
    }

    const toDelete = Math.max(0, Math.trunc(total - maxRows));
    if (!toDelete) return;

    const oldest = await this.upstash.command(["ZRANGE", ASSESSMENT_INDEX_KEY, 0, toDelete - 1]);
    if (!Array.isArray(oldest) || !oldest.length) {
      return;
    }

    const commands: Array<Array<string | number>> = [];
    oldest.forEach((cacheKey) => {
      const key = String(cacheKey || "").trim();
      if (!key) return;
      commands.push(["DEL", `${ASSESSMENT_KEY_PREFIX}:${key}`]);
      commands.push(["ZREM", ASSESSMENT_INDEX_KEY, key]);
    });
    if (commands.length) {
      await this.upstash.pipeline(commands);
    }
  }

  async loadSourceScores(): Promise<Record<string, SourceQualityScore>> {
    if (!this.upstash) return {};
    const rows = await this.upstash.hgetall(SOURCE_STATS_KEY);
    const scores: Record<string, SourceQualityScore> = {};

    Object.entries(rows).forEach(([sourceId, payload]) => {
      try {
        const row = JSON.parse(payload || "{}");
        scores[sourceId] = {
          sourceId,
          qualityScore: Number(row.quality_score || 0),
          articleCount: Number(row.article_count || 0),
          mustReadRate: Number(row.must_read_rate || 0),
          avgConfidence: Number(row.avg_confidence || 0),
          freshness: Number(row.freshness || 0),
        };
      } catch {
        // ignore corrupted row
      }
    });

    return scores;
  }

  async upsertSourceScores(scores: SourceQualityScore[]): Promise<void> {
    if (!scores.length || !this.upstash) return;

    const mapping: Record<string, string> = {};
    scores.forEach((score) => {
      mapping[score.sourceId] = JSON.stringify({
        quality_score: score.qualityScore,
        article_count: score.articleCount,
        must_read_rate: score.mustReadRate,
        avg_confidence: score.avgConfidence,
        freshness: score.freshness,
        updated_at: nowIso(),
      });
    });

    await this.upstash.hset(SOURCE_STATS_KEY, mapping);
  }

  async loadReportArticleCounts(): Promise<Record<string, number>> {
    if (!this.upstash) return {};
    const rows = await this.upstash.hgetall(REPORT_COUNTS_KEY);
    const counts: Record<string, number> = {};
    Object.entries(rows).forEach(([articleKey, hitCount]) => {
      const key = String(articleKey || "").trim();
      if (!key) return;
      const numeric = Number(hitCount || 0);
      counts[key] = Number.isFinite(numeric) ? Math.trunc(numeric) : 0;
    });
    return counts;
  }

  async recordReportArticleKeys(articleKeys: string[]): Promise<void> {
    if (!articleKeys.length || !this.upstash) return;

    const increments: Record<string, number> = {};
    articleKeys.forEach((articleKey) => {
      const normalized = String(articleKey || "").trim();
      if (!normalized) return;
      increments[normalized] = (increments[normalized] || 0) + 1;
    });

    const commands: Array<Array<string | number>> = [];
    Object.entries(increments).forEach(([articleKey, increment]) => {
      commands.push(["HINCRBY", REPORT_COUNTS_KEY, articleKey, increment]);
    });

    if (commands.length) {
      await this.upstash.pipeline(commands);
    }
  }
}
