import webPush from "web-push";

let configured = false;

function ensureConfigured(): void {
  if (configured) return;
  const publicKey = process.env.VAPID_PUBLIC_KEY?.trim();
  const privateKey = process.env.VAPID_PRIVATE_KEY?.trim();
  const subject = process.env.VAPID_SUBJECT?.trim() || "mailto:noreply@example.com";
  if (!publicKey || !privateKey) throw new Error("Missing VAPID keys");
  webPush.setVapidDetails(subject, publicKey, privateKey);
  configured = true;
}

export interface PushSubscriptionData {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

export async function sendPushNotification(
  subscription: PushSubscriptionData,
  payload: { title: string; body: string; url?: string },
): Promise<void> {
  ensureConfigured();
  await webPush.sendNotification(subscription, JSON.stringify(payload));
}

export function getVapidPublicKey(): string {
  const key = process.env.VAPID_PUBLIC_KEY?.trim();
  if (!key) throw new Error("Missing VAPID_PUBLIC_KEY");
  return key;
}
