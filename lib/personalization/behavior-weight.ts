function parseDate(value: string): Date | null {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

function decayWeight(ageDays: number, halfLifeDays: number): number {
  if (ageDays <= 0 || halfLifeDays <= 0) return 1;
  return 0.5 ** (ageDays / halfLifeDays);
}

export function computeBehaviorMultipliers(
  sourceDailyClicks: Record<string, Record<string, number>>,
  options: {
    lookbackDays?: number;
    halfLifeDays?: number;
    minMultiplier?: number;
    maxMultiplier?: number;
    nowUtc?: Date;
  } = {},
): Record<string, number> {
  const nowUtc = options.nowUtc || new Date();
  const days = Math.max(1, options.lookbackDays || 90);
  const maxAge = days - 1;
  const halfLifeDays = options.halfLifeDays || 21;
  const minMultiplier = options.minMultiplier ?? 0.85;
  const maxMultiplier = options.maxMultiplier ?? 1.2;

  const decayedScores: Record<string, number> = {};
  for (const [sourceId, daily] of Object.entries(sourceDailyClicks)) {
    let score = 0;
    for (const [dateText, count] of Object.entries(daily || {})) {
      const dt = parseDate(dateText);
      if (!dt) continue;
      const ageDays = Math.max(0, Math.trunc((nowUtc.getTime() - dt.getTime()) / 86_400_000));
      if (ageDays > maxAge) continue;
      score += Math.max(0, Math.trunc(count || 0)) * decayWeight(ageDays, halfLifeDays);
    }
    if (score > 0) {
      decayedScores[sourceId] = score;
    }
  }

  if (!Object.keys(decayedScores).length) {
    return {};
  }

  const baseline = Object.values(decayedScores).reduce((sum, score) => sum + score, 0) / Object.keys(decayedScores).length;
  if (baseline <= 0) {
    return Object.fromEntries(Object.keys(decayedScores).map((sourceId) => [sourceId, 1]));
  }

  const low = Math.min(minMultiplier, maxMultiplier);
  const high = Math.max(minMultiplier, maxMultiplier);
  const multipliers: Record<string, number> = {};
  for (const [sourceId, score] of Object.entries(decayedScores)) {
    const centered = (score - baseline) / baseline;
    const raw = 1 + centered * 0.25;
    multipliers[sourceId] = Math.round(Math.max(low, Math.min(high, raw)) * 10_000) / 10_000;
  }
  return multipliers;
}

export function selectPreferredSources(
  sourceDailyClicks: Record<string, Record<string, number>>,
  options: { minClicks?: number; topQuantile?: number } = {},
): Set<string> {
  const minClicks = options.minClicks ?? 2;
  const topQuantile = Math.max(0.01, Math.min(1, options.topQuantile ?? 0.3));

  const totals: Array<[string, number]> = [];
  for (const [sourceId, daily] of Object.entries(sourceDailyClicks)) {
    const total = Object.values(daily || {}).reduce((sum, value) => sum + Math.max(0, Math.trunc(value || 0)), 0);
    if (total >= minClicks) {
      totals.push([sourceId, total]);
    }
  }

  if (!totals.length) {
    return new Set();
  }

  totals.sort((a, b) => b[1] - a[1]);
  const keepCount = Math.max(1, Math.ceil(totals.length * topQuantile));
  return new Set(totals.slice(0, keepCount).map(([sourceId]) => sourceId));
}
