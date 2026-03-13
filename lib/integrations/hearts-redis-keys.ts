export function heartsKey(userId: string): string {
  return `hearts:${userId}`;
}

export function heartsMetaKey(articleId: string): string {
  return `hearts:meta:${articleId}`;
}
