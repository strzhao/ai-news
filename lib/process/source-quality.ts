import { Article, ArticleAssessment, SourceConfig, SourceQualityScore, WORTH_MUST_READ } from "@/lib/domain/models";

function behaviorPriorityScore(multiplier: number): number {
  const clipped = Math.max(0.85, Math.min(1.2, Number(multiplier) || 1));
  return ((clipped - 0.85) / (1.2 - 0.85)) * 100;
}

export function rankSourcesByPriority(
  sources: SourceConfig[],
  historicalScores: Record<string, SourceQualityScore>,
  behaviorMultipliers: Record<string, number> = {},
): SourceConfig[] {
  const total = Math.max(1, sources.length);
  const indexMap = new Map<string, number>();
  sources.forEach((source, index) => indexMap.set(source.id, index));

  const priority = (source: SourceConfig): number => {
    const historical = historicalScores[source.id];
    const sourceQuality = historical ? historical.qualityScore : 50;
    const behaviorMultiplier = behaviorMultipliers[source.id] || 1;
    const behaviorPriority = behaviorPriorityScore(behaviorMultiplier);
    const index = indexMap.get(source.id) ?? total - 1;
    const curatedPriority = ((total - index) / total) * 100;
    return curatedPriority * 0.45 + source.sourceWeight * 100 * 0.25 + sourceQuality * 0.15 + behaviorPriority * 0.15;
  };

  return [...sources].sort((a, b) => priority(b) - priority(a));
}

export function buildSourceFetchLimits(
  sources: SourceConfig[],
  highLimit = 30,
  mediumLimit = 22,
  lowLimit = 12,
): Record<string, number> {
  if (!sources.length) return {};
  const highCutoff = Math.max(1, Math.trunc(sources.length / 3));
  const mediumCutoff = Math.max(highCutoff + 1, Math.trunc((sources.length * 2) / 3));
  const limits: Record<string, number> = {};
  sources.forEach((source, index) => {
    if (index < highCutoff) {
      limits[source.id] = highLimit;
    } else if (index < mediumCutoff) {
      limits[source.id] = mediumLimit;
    } else {
      limits[source.id] = lowLimit;
    }
  });
  return limits;
}

export function buildBudgetedSourceLimits(
  prioritizedSources: SourceConfig[],
  sourceLimits: Record<string, number>,
  totalBudget: number,
  minPerSource = 3,
  preferredSourceIds: Set<string> = new Set(),
  explorationRatio = 0,
): Record<string, number> {
  if (totalBudget <= 0 || !prioritizedSources.length) {
    return sourceLimits;
  }

  const count = prioritizedSources.length;
  if (totalBudget < count) {
    const limited: Record<string, number> = {};
    prioritizedSources.forEach((source, index) => {
      limited[source.id] = index < totalBudget ? 1 : 0;
    });
    return limited;
  }

  const base = totalBudget >= count * minPerSource ? minPerSource : Math.max(1, Math.trunc(totalBudget / count));
  const allocated: Record<string, number> = {};
  prioritizedSources.forEach((source) => {
    const cap = Math.trunc(sourceLimits[source.id] ?? base);
    allocated[source.id] = Math.min(base, Math.max(0, cap));
  });

  let remaining = Math.max(0, totalBudget - Object.values(allocated).reduce((sum, value) => sum + value, 0));
  if (remaining <= 0) {
    return allocated;
  }

  const rooms: Record<string, number> = {};
  prioritizedSources.forEach((source) => {
    rooms[source.id] = Math.max(0, Math.trunc(sourceLimits[source.id] ?? allocated[source.id]) - allocated[source.id]);
  });

  const totalRoom = Object.values(rooms).reduce((sum, value) => sum + value, 0);
  if (totalRoom <= 0) {
    return allocated;
  }

  for (const source of prioritizedSources) {
    const room = rooms[source.id];
    if (room <= 0 || remaining <= 0) continue;
    const add = Math.min(room, Math.trunc((remaining * room) / Math.max(totalRoom, 1)));
    if (add <= 0) continue;
    allocated[source.id] += add;
    rooms[source.id] -= add;
    remaining -= add;
  }

  for (const source of prioritizedSources) {
    if (remaining <= 0) break;
    const room = rooms[source.id];
    if (room <= 0) continue;
    const add = Math.min(room, remaining);
    allocated[source.id] += add;
    remaining -= add;
  }

  const ratio = Math.max(0, Math.min(1, Number(explorationRatio) || 0));
  if (ratio <= 0 || !preferredSourceIds.size) {
    return allocated;
  }

  const exploratoryIds = prioritizedSources.map((source) => source.id).filter((id) => !preferredSourceIds.has(id));
  if (!exploratoryIds.length) {
    return allocated;
  }

  const targetExploration = Math.round(totalBudget * ratio);
  if (targetExploration <= 0) {
    return allocated;
  }

  const currentExploration = exploratoryIds.reduce((sum, id) => sum + (allocated[id] || 0), 0);
  let needed = Math.max(0, targetExploration - currentExploration);
  if (needed <= 0) {
    return allocated;
  }

  const donors = [...prioritizedSources].reverse().map((source) => source.id).filter((id) => preferredSourceIds.has(id));
  const recipients = prioritizedSources.map((source) => source.id).filter((id) => exploratoryIds.includes(id));

  while (needed > 0) {
    const recipient = recipients.find((id) => (allocated[id] || 0) < Math.trunc(sourceLimits[id] || 0));
    if (!recipient) break;
    const donor = donors.find((id) => (allocated[id] || 0) > 1);
    if (!donor) break;
    allocated[donor] -= 1;
    allocated[recipient] = (allocated[recipient] || 0) + 1;
    needed -= 1;
  }

  return allocated;
}

export function computeSourceQualityScores(
  articles: Article[],
  assessments: Record<string, ArticleAssessment>,
  historicalScores: Record<string, SourceQualityScore> = {},
  lookbackDays = 30,
  minArticlesForReliableScore = 8,
  nowUtc: Date = new Date(),
): SourceQualityScore[] {
  const lookbackThreshold = new Date(nowUtc.getTime() - lookbackDays * 86_400_000);
  const recentThreshold = new Date(nowUtc.getTime() - 7 * 86_400_000);

  const grouped = new Map<string, Array<{ article: Article; assessment: ArticleAssessment }>>();
  for (const article of articles) {
    if (article.publishedAt && article.publishedAt < lookbackThreshold) {
      continue;
    }
    const assessment = assessments[article.id];
    if (!assessment) {
      continue;
    }
    if (!grouped.has(article.sourceId)) {
      grouped.set(article.sourceId, []);
    }
    grouped.get(article.sourceId)?.push({ article, assessment });
  }

  const results: SourceQualityScore[] = [];

  for (const [sourceId, rows] of grouped.entries()) {
    const count = rows.length;
    if (!count) continue;

    const avgQuality = rows.reduce((sum, row) => sum + row.assessment.qualityScore, 0) / count;
    const avgImpact =
      rows.reduce(
        (sum, row) => sum + (row.assessment.companyImpact + row.assessment.teamImpact + row.assessment.personalImpact) / 3,
        0,
      ) / count;
    const mustReadRate = rows.filter((row) => row.assessment.worth === WORTH_MUST_READ).length / count;
    const avgConfidence = rows.reduce((sum, row) => sum + row.assessment.confidence, 0) / count;
    const freshness =
      rows.filter((row) => row.article.publishedAt && row.article.publishedAt >= recentThreshold).length / count;

    const batchQuality =
      avgQuality * 0.4 + avgImpact * 0.25 + mustReadRate * 100 * 0.2 + avgConfidence * 100 * 0.1 + freshness * 100 * 0.05;

    const historical = historicalScores[sourceId];
    let quality = batchQuality;
    if (historical && count < minArticlesForReliableScore) {
      const weight = count / Math.max(minArticlesForReliableScore, 1);
      quality = historical.qualityScore * (1 - weight) + batchQuality * weight;
    } else if (historical) {
      quality = historical.qualityScore * 0.35 + batchQuality * 0.65;
    } else if (count < minArticlesForReliableScore) {
      const weight = count / Math.max(minArticlesForReliableScore, 1);
      quality = 50 * (1 - weight) + batchQuality * weight;
    }

    results.push({
      sourceId,
      qualityScore: Math.round(Math.max(0, Math.min(100, quality)) * 100) / 100,
      articleCount: count,
      mustReadRate: Math.round(mustReadRate * 10_000) / 10_000,
      avgConfidence: Math.round(avgConfidence * 10_000) / 10_000,
      freshness: Math.round(freshness * 10_000) / 10_000,
    });
  }

  return results.sort((a, b) => b.qualityScore - a.qualityScore);
}
