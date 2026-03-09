"use client";

import { useEffect, useState } from "react";

const ERROR_MESSAGE_MAP: Record<string, string> = {
  state_mismatch: "登录状态校验失败，请重新发起登录。",
  authorization_not_completed: "授权未完成，请重试。",
  finalize_failed: "登录会话创建失败，请重试。",
};

function redirectToHome(path?: string, errorCode?: string): void {
  const target = errorCode ? `/?auth_error=${encodeURIComponent(errorCode)}` : (path || "/");
  window.location.replace(target);
}

export default function AuthCallbackPage(): React.ReactNode {
  const [statusText, setStatusText] = useState("正在完成统一账号登录...");

  useEffect(() => {
    const callbackUrl = new URL(window.location.href);
    const authorized = callbackUrl.searchParams.get("authorized");
    const returnedState = callbackUrl.searchParams.get("state");

    if (authorized !== "1" || !returnedState) {
      const code = authorized !== "1" ? "authorization_not_completed" : "state_mismatch";
      setStatusText(ERROR_MESSAGE_MAP[code]);
      redirectToHome(undefined, code);
      return;
    }

    void (async () => {
      try {
        const response = await fetch("/api/auth/session/finalize", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ state: returnedState }),
        });

        const payload = (await response.json()) as { ok: boolean; next?: string; error?: string };
        if (!response.ok || !payload.ok) {
          const code = payload.error || "finalize_failed";
          setStatusText(ERROR_MESSAGE_MAP[code] || "登录会话创建失败，请重试。");
          redirectToHome(undefined, code);
          return;
        }

        redirectToHome(payload.next || "/");
      } catch {
        setStatusText(ERROR_MESSAGE_MAP.finalize_failed);
        redirectToHome(undefined, "finalize_failed");
      }
    })();
  }, []);

  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh" }}>
      <div style={{ textAlign: "center" }}>
        <h1 style={{ fontSize: 24, fontWeight: 650, marginBottom: 12 }}>登录处理中</h1>
        <p style={{ color: "var(--muted)", fontSize: 14 }}>{statusText}</p>
      </div>
    </div>
  );
}
