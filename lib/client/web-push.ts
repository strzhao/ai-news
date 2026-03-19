function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const array = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) array[i] = raw.charCodeAt(i);
  return array;
}

export function isPushSupported(): boolean {
  return (
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

export async function subscribeToPush(): Promise<boolean> {
  if (!isPushSupported()) return false;

  const registration = await navigator.serviceWorker.ready;

  const res = await fetch("/api/v1/web-push/vapid-key");
  const { publicKey } = (await res.json()) as { publicKey?: string };
  if (!publicKey) return false;

  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(publicKey)
      .buffer as ArrayBuffer,
  });

  const saveRes = await fetch("/api/v1/web-push/subscribe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ subscription: subscription.toJSON() }),
  });
  const savePayload = (await saveRes.json()) as { ok?: boolean };
  return savePayload.ok === true;
}

export async function unsubscribeFromPush(): Promise<boolean> {
  if (!("serviceWorker" in navigator)) return false;

  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.getSubscription();
  if (subscription) await subscription.unsubscribe();

  const res = await fetch("/api/v1/web-push/subscribe", {
    method: "DELETE",
    credentials: "include",
  });
  const payload = (await res.json()) as { ok?: boolean };
  return payload.ok === true;
}
