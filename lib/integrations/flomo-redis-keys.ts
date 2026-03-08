export function flomoConfigKey(userId: string): string {
  return `flomo:config:${userId}`;
}

export function flomoRateKey(userId: string, dateStr: string): string {
  return `flomo:rate:${userId}:${dateStr.replace(/-/g, "")}`;
}

export function flomoPushLogKey(userId: string): string {
  return `flomo:push-log:${userId}`;
}
