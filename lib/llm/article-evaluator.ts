import crypto from "node:crypto";
import { ArticleEvalCache } from "@/lib/cache/article-eval-cache";
import {
  Article,
  ArticleAssessment,
  WORTH_MUST_READ,
  WORTH_SKIP,
  WORTH_WORTH_READING,
} from "@/lib/domain/models";
import { DeepSeekClient, DeepSeekError } from "@/lib/llm/deepseek-client";

const VALID_WORTH = new Set([WORTH_MUST_READ, WORTH_WORTH_READING, WORTH_SKIP]);

function coerceScore(value: unknown): number {
  let score = Number(value);
  if (!Number.isFinite(score)) score = 0;
  if (score >= 0 && score <= 10) {
    score *= 10;
  }
  return Math.max(0, Math.min(100, score));
}

function coerceConfidence(value: unknown): number {
  const confidence = Number(value);
  if (!Number.isFinite(confidence)) return 0;
  return Math.max(0, Math.min(1, confidence));
}

function pickScore(row: Record<string, unknown>, keys: string[], fallback = 0): number {
  for (const key of keys) {
    if (key in row) {
      return coerceScore(row[key]);
    }
  }
  return fallback;
}

export function computeArticleContentHash(article: Article): string {
  const base = `${article.title.trim()}|${article.summaryRaw.trim()}|${article.leadParagraph.trim()}`;
  return crypto.createHash("sha256").update(base).digest("hex");
}

export function buildArticleCacheKey(options: {
  article: Article;
  modelName: string;
  promptVersion: string;
}): string {
  const base = `${options.modelName.trim()}|${options.promptVersion.trim()}|${options.article.url
    .trim()
    .toLowerCase()}|${computeArticleContentHash(options.article)}`;
  return crypto.createHash("sha256").update(base).digest("hex");
}

export class ArticleEvaluator {
  readonly promptVersion: string;

  readonly maxRetries: number;

  constructor(
    private readonly client: DeepSeekClient,
    public readonly cache: ArticleEvalCache,
    private readonly articleTypes: string[] = ["other"],
  ) {
    this.promptVersion = String(process.env.AI_EVAL_PROMPT_VERSION || "v7");
    this.maxRetries = Math.max(0, Number.parseInt(String(process.env.AI_EVAL_MAX_RETRIES || "2"), 10) || 0);

    const deduped = Array.from(new Set(this.articleTypes.map((item) => String(item || "").trim()).filter(Boolean)));
    if (!deduped.includes("other")) deduped.push("other");
    this.articleTypes = deduped.length ? deduped : ["other"];
  }

  async evaluateArticles(articles: Article[]): Promise<Record<string, ArticleAssessment>> {
    const assessments: Record<string, ArticleAssessment> = {};

    for (const article of articles) {
      const cacheKey = buildArticleCacheKey({
        article,
        modelName: this.client.model,
        promptVersion: this.promptVersion,
      });

      const cached = await this.cache.getAssessment(cacheKey);
      if (cached) {
        assessments[article.id] = { ...cached, cacheKey };
        continue;
      }

      let lastError: unknown;
      for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
        try {
          const assessment = await this.evaluateArticle(article);
          assessment.cacheKey = cacheKey;

          await this.cache.setAssessment({
            cacheKey,
            sourceId: article.sourceId,
            articleId: article.id,
            contentHash: computeArticleContentHash(article),
            modelName: this.client.model,
            promptVersion: this.promptVersion,
            assessment,
          });

          assessments[article.id] = assessment;
          lastError = undefined;
          break;
        } catch (error) {
          lastError = error;
          if (attempt < this.maxRetries) {
            await new Promise((resolve) => setTimeout(resolve, Math.round(350 * (attempt + 1))));
          }
        }
      }

      if (lastError) {
        // keep the pipeline running
        continue;
      }
    }

    await this.cache.prune(5000);
    return assessments;
  }

  async evaluateArticle(article: Article): Promise<ArticleAssessment> {
    const allowedTypes = this.articleTypes.join(", ");
    const systemPrompt =
      "你是互联网公司 AI 主编，目标是判断文章是否对公司、团队和个人在 AI 发展上有实质帮助。" +
      "核心是阅读 ROI：未来 7-30 天是否能带来更好的决策、执行或能力升级。" +
      "优先考虑：company_impact、team_impact、personal_impact、execution_clarity、novelty。" +
      "允许高杠杆认知框架和决策方法进入必读，不要求必须有代码；但空泛观点和营销宣传要降级。" +
      "你必须只输出 JSON，不能输出解释文本。" +
      "输出字段：article_id, worth, reading_roi_score, company_impact, team_impact, personal_impact, " +
      "execution_clarity, novelty, clarity_score, one_line_summary, reason_short, action_hint, " +
      "best_for_roles, evidence_signals, confidence, primary_type, secondary_types。" +
      "worth 仅允许：必读/可读/跳过。" +
      `primary_type 必须从以下枚举中选择：${allowedTypes}。`;

    const payload = {
      article_id: article.id,
      title: article.title,
      published_at: article.publishedAt ? article.publishedAt.toISOString() : "",
      summary: article.summaryRaw,
      lead_paragraph: article.leadParagraph,
    };

    const result = await this.client.chatJson(
      [
        { role: "system", content: systemPrompt },
        { role: "user", content: JSON.stringify(payload) },
      ],
      0.1,
    );

    return this.parseAssessment(article.id, result);
  }

  private parseAssessment(articleId: string, row: Record<string, unknown>): ArticleAssessment {
    if (!row || typeof row !== "object") {
      throw new DeepSeekError(`Invalid article assessment payload: ${row}`);
    }

    const worth = String(row.worth || "").trim();
    if (!VALID_WORTH.has(worth as any)) {
      throw new DeepSeekError(`Invalid worth label from DeepSeek: ${worth}`);
    }

    const evidenceSignalsRaw = Array.isArray(row.evidence_signals) ? row.evidence_signals : [];
    const evidenceSignals = Array.from(new Set(evidenceSignalsRaw.map((item) => String(item || "").trim()).filter(Boolean)));
    if (!evidenceSignals.length) {
      evidenceSignals.push("none");
    }

    const oneLineSummary = String(row.one_line_summary || "").trim();
    const reasonShort = String(row.reason_short || "").trim();
    if (!oneLineSummary) throw new DeepSeekError("DeepSeek returned empty one_line_summary");
    if (!reasonShort) throw new DeepSeekError("DeepSeek returned empty reason_short");

    const rolesRaw = Array.isArray(row.best_for_roles) ? row.best_for_roles : [];
    const bestForRoles = Array.from(new Set(rolesRaw.map((item) => String(item || "").trim()).filter(Boolean)));

    const allowedTypes = new Set(this.articleTypes);
    const rawPrimaryType = String(row.primary_type || "").trim() || "other";
    const primaryType = allowedTypes.has(rawPrimaryType) ? rawPrimaryType : "other";
    const rawSecondaryTypes = Array.isArray(row.secondary_types) ? row.secondary_types : [];

    const secondaryTypes = Array.from(
      new Set(
        rawSecondaryTypes
          .map((item) => String(item || "").trim())
          .filter((value) => value && value !== primaryType && allowedTypes.has(value)),
      ),
    ).slice(0, 2);

    const qualityScore = pickScore(row, ["reading_roi_score", "quality_score"], 0);
    const companyImpact = pickScore(row, ["company_impact"], qualityScore);
    const teamImpact = pickScore(row, ["team_impact"], qualityScore);
    const personalImpact = pickScore(row, ["personal_impact"], qualityScore);
    const executionClarity = pickScore(row, ["execution_clarity", "actionability_score"], qualityScore);
    const novelty = pickScore(row, ["novelty", "novelty_score"], 0);
    const clarity = pickScore(row, ["clarity_score"], 0);

    return {
      articleId: String(row.article_id || articleId).trim() || articleId,
      worth: worth as ArticleAssessment["worth"],
      qualityScore,
      practicalityScore: (companyImpact + teamImpact + personalImpact) / 3,
      actionabilityScore: executionClarity,
      noveltyScore: novelty,
      clarityScore: clarity,
      oneLineSummary,
      reasonShort,
      companyImpact,
      teamImpact,
      personalImpact,
      executionClarity,
      actionHint: String(row.action_hint || "").trim(),
      bestForRoles,
      evidenceSignals,
      confidence: coerceConfidence(row.confidence),
      primaryType,
      secondaryTypes,
      cacheKey: "",
    };
  }
}
