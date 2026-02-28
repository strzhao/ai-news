function parseDate(value: string): Date | null {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

function decayWeight(ageDays: number, halfLifeDays: number): number {
  if (ageDays <= 0 || halfLifeDays <= 0) return 1;
  return 0.5 ** (ageDays / halfLifeDays);
}

export function computeTypeMultipliers(
  typeDailyClicks: Record<string, Record<string, number>>,
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
  const minMultiplier = options.minMultiplier ?? 0.9;
  const maxMultiplier = options.maxMultiplier ?? 1.15;

  const decayedScores: Record<string, number> = {};
  for (const [primaryType, daily] of Object.entries(typeDailyClicks)) {
    let score = 0;
    for (const [dateText, count] of Object.entries(daily || {})) {
      const dt = parseDate(dateText);
      if (!dt) continue;
      const ageDays = Math.max(0, Math.trunc((nowUtc.getTime() - dt.getTime()) / 86_400_000));
      if (ageDays > maxAge) continue;
      score += Math.max(0, Math.trunc(count || 0)) * decayWeight(ageDays, halfLifeDays);
    }
    if (score > 0) {
      decayedScores[primaryType] = score;
    }
  }

  if (!Object.keys(decayedScores).length) {
    return {};
  }

  const baseline = Object.values(decayedScores).reduce((sum, score) => sum + score, 0) / Object.keys(decayedScores).length;
  if (baseline <= 0) {
    return Object.fromEntries(Object.keys(decayedScores).map((primaryType) => [primaryType, 1]));
  }

  const low = Math.min(minMultiplier, maxMultiplier);
  const high = Math.max(minMultiplier, maxMultiplier);
  const multipliers: Record<string, number> = {};
  for (const [primaryType, score] of Object.entries(decayedScores)) {
    const centered = (score - baseline) / baseline;
    const raw = 1 + centered * 0.25;
    multipliers[primaryType] = Math.round(Math.max(low, Math.min(high, raw)) * 10_000) / 10_000;
  }

  return multipliers;
}
