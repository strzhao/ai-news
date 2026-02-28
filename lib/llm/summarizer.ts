import { Article, ArticleAssessment, SourceQualityScore } from "@/lib/domain/models";
import { DeepSeekClient, DeepSeekError } from "@/lib/llm/deepseek-client";

const VALID_WORTH = new Set(["必读", "可读", "跳过"]);
const TAG_SPLIT_RE = /[,/\n，、;；|]+/;

interface AIHighlight {
  article_id: string;
  rank: number;
  one_line_summary: string;
  worth: string;
  reason_short: string;
}

export class DigestSummarizer {
  constructor(private readonly client: DeepSeekClient) {}

  async buildOverviewContent(options: {
    articles: Article[];
    date: string;
    timezoneName: string;
    topN?: number;
    language?: string;
    assessments?: Record<string, ArticleAssessment>;
    sourceQualityScores?: Record<string, SourceQualityScore>;
  }): Promise<[string, string[]]> {
    const articleList = options.articles;
    if (!articleList.length) {
      return ["今日暂无高质量 AI 更新。", []];
    }

    const llmResult = await this.summarizeOverviewWithLlm({
      articles: articleList,
      date: options.date,
      timezoneName: options.timezoneName,
      language: options.language || "zh-CN",
      topN: options.topN || 8,
      assessments: options.assessments,
      sourceQualityScores: options.sourceQualityScores,
    });

    const summaryLines = Array.isArray(llmResult.top_summary) ? llmResult.top_summary : [];
    const topSummary = summaryLines
      .map((line) => String(line).trim())
      .filter(Boolean)
      .map((line) => `- ${line}`)
      .join("\n");

    if (!topSummary) {
      throw new DeepSeekError("DeepSeek returned empty top_summary");
    }

    const dailyTags = this.parseDailyTags(llmResult);
    return [topSummary, dailyTags];
  }

  private buildInputs(
    articles: Article[],
    assessments?: Record<string, ArticleAssessment>,
    sourceQualityScores?: Record<string, SourceQualityScore>,
  ): Array<Record<string, unknown>> {
    const inputs: Array<Record<string, unknown>> = [];

    for (const article of articles) {
      const assessment = assessments?.[article.id];
      const sourceQuality = sourceQualityScores?.[article.sourceId];
      const row: Record<string, unknown> = {
        article_id: article.id,
        title: article.title,
        source: article.sourceName,
        url: article.url,
        published_at: article.publishedAt ? article.publishedAt.toISOString() : "",
        summary: article.summaryRaw,
        lead_paragraph: article.leadParagraph,
      };

      if (assessment) {
        row.assessment = {
          worth: assessment.worth,
          quality_score: assessment.qualityScore,
          practicality_score: assessment.practicalityScore,
          actionability_score: assessment.actionabilityScore,
          novelty_score: assessment.noveltyScore,
          clarity_score: assessment.clarityScore,
          company_impact: assessment.companyImpact,
          team_impact: assessment.teamImpact,
          personal_impact: assessment.personalImpact,
          execution_clarity: assessment.executionClarity,
          one_line_summary: assessment.oneLineSummary,
          reason_short: assessment.reasonShort,
          action_hint: assessment.actionHint,
          best_for_roles: assessment.bestForRoles,
          evidence_signals: assessment.evidenceSignals,
          confidence: assessment.confidence,
          primary_type: assessment.primaryType,
          secondary_types: assessment.secondaryTypes,
        };
      }

      if (sourceQuality) {
        row.source_quality_score = sourceQuality.qualityScore;
      }

      inputs.push(row);
    }

    return inputs;
  }

  private async summarizeOverviewWithLlm(options: {
    articles: Article[];
    date: string;
    timezoneName: string;
    language: string;
    topN: number;
    assessments?: Record<string, ArticleAssessment>;
    sourceQualityScores?: Record<string, SourceQualityScore>;
  }): Promise<Record<string, unknown>> {
    const inputs = this.buildInputs(options.articles, options.assessments, options.sourceQualityScores);
    const systemPrompt =
      "你是顶级 AI 资讯主编，偏产业实战。" +
      "你将收到文章基础信息和单篇评估结果。" +
      "你的任务仅有两项：1) 输出今日速览 top_summary（2-3条主题整合）；2) 输出日报标签 daily_tags（3-10个）。" +
      "必须严格输出 JSON，不允许输出 Markdown 或解释。" +
      "top_summary 要求主题整合，不可逐篇复述；每条尽量 22-32 字。" +
      "daily_tags 只保留技术维度标签。" +
      "输出字段：top_summary:string[]，daily_tags:string[]。";

    const userPrompt = {
      date: options.date,
      timezone: options.timezoneName,
      language: options.language,
      top_n: options.topN,
      articles: inputs,
    };

    const result = await this.client.chatJson(
      [
        { role: "system", content: systemPrompt },
        { role: "user", content: JSON.stringify(userPrompt) },
      ],
      0.1,
    );

    if (!result || typeof result !== "object") {
      throw new DeepSeekError(`Unexpected summarize result: ${result}`);
    }

    return result;
  }

  private parseDailyTags(result: Record<string, unknown>): string[] {
    const rawTags = result.daily_tags;
    const tags = this.coerceTags(rawTags);
    const cleaned = tags
      .map((tag) => String(tag).trim().replace(/^#+/, ""))
      .filter(Boolean)
      .map((tag) => `#${tag}`);

    return Array.from(new Set(cleaned)).slice(0, 12);
  }

  private coerceTags(tags: unknown): string[] {
    if (Array.isArray(tags)) {
      return tags.map((item) => String(item));
    }
    if (typeof tags === "string") {
      const raw = tags.trim();
      if (!raw) return [];
      const normalized = raw.replace(/#/g, " ");
      if (TAG_SPLIT_RE.test(normalized)) {
        return normalized.split(TAG_SPLIT_RE).map((part) => part.trim()).filter(Boolean);
      }
      return normalized.split(/\s+/).map((part) => part.trim()).filter(Boolean);
    }
    return [];
  }

  parseHighlights(result: Record<string, unknown>, topN: number): AIHighlight[] {
    const rawHighlights = Array.isArray(result.highlights) ? result.highlights : [];
    const parsed: AIHighlight[] = [];

    for (const row of rawHighlights) {
      if (!row || typeof row !== "object") continue;
      const articleId = String((row as any).article_id || "").trim();
      if (!articleId) continue;
      const worth = String((row as any).worth || "").trim();
      if (!VALID_WORTH.has(worth)) {
        throw new DeepSeekError(`Invalid worth label from DeepSeek: ${worth}`);
      }
      parsed.push({
        article_id: articleId,
        rank: Number((row as any).rank || parsed.length + 1),
        one_line_summary: String((row as any).one_line_summary || "").trim(),
        worth,
        reason_short: String((row as any).reason_short || "").trim(),
      });
    }

    parsed.sort((a, b) => a.rank - b.rank);
    return parsed.slice(0, topN);
  }
}
