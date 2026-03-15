/** Set of user IDs who have enabled web push */
export const WEB_PUSH_SUBSCRIBERS_KEY = "webpush:subscribers";

/** Hash storing a user's push subscription object (endpoint, keys) */
export function webPushSubscriptionKey(userId: string): string {
  return `webpush:sub:${userId}`;
}

/** Hash storing user's web push config (enabled flag) */
export function webPushConfigKey(userId: string): string {
  return `webpush:config:${userId}`;
}
