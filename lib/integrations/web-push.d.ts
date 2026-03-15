declare module "web-push" {
  interface PushSubscription {
    endpoint: string;
    keys: { p256dh: string; auth: string };
  }

  interface SendResult {
    statusCode: number;
    body: string;
    headers: Record<string, string>;
  }

  function setVapidDetails(subject: string, publicKey: string, privateKey: string): void;
  function sendNotification(subscription: PushSubscription, payload: string): Promise<SendResult>;

  export default { setVapidDetails, sendNotification };
  export { setVapidDetails, sendNotification };
}
