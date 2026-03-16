export function userPicksKey(userId: string): string {
  return `user_picks:${userId}`;
}

export function userPicksMetaKey(articleId: string): string {
  return `user_picks:meta:${articleId}`;
}
