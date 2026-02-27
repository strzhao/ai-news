export function utcDateKey(date: Date = new Date()): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}${m}${d}`;
}

export function keyToIsoDate(dateKey: string): string {
  return `${dateKey.slice(0, 4)}-${dateKey.slice(4, 6)}-${dateKey.slice(6, 8)}`;
}

export function lastNDateKeys(days: number): string[] {
  const count = Math.max(1, Math.min(days, 120));
  const now = new Date();
  const keys: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const date = new Date(now);
    date.setUTCDate(now.getUTCDate() - i);
    keys.push(utcDateKey(date));
  }
  return keys;
}

