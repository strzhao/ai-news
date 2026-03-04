"use client";

import { useEffect, useState } from "react";

import { AUTH_STATE_STORAGE_KEY } from "@/lib/auth-config";

const ERROR_MESSAGE_MAP: Record<string, string> = {
  state_mismatch: "登录状态校验失败，请重新发起登录。",
  authorization_not_completed: "授权未完成，请重试。"
};

function redirectToHome(code?: string): void {
  const target = code ? `/?auth_error=${encodeURIComponent(code)}` : "/";
  window.location.replace(target);
}

export default function AuthCallbackPage(): React.ReactNode {
  const [statusText, setStatusText] = useState("正在完成统一账号登录...");

  useEffect(() => {
    const callbackUrl = new URL(window.location.href);
    const authorized = callbackUrl.searchParams.get("authorized");
    const returnedState = callbackUrl.searchParams.get("state");

    let expectedState: string | null = null;
    try {
      expectedState = window.sessionStorage.getItem(AUTH_STATE_STORAGE_KEY);
      window.sessionStorage.removeItem(AUTH_STATE_STORAGE_KEY);
    } catch {
      expectedState = null;
    }

    if (authorized !== "1") {
      setStatusText(ERROR_MESSAGE_MAP.authorization_not_completed);
      redirectToHome("authorization_not_completed");
      return;
    }

    if (!returnedState || !expectedState || returnedState !== expectedState) {
      setStatusText(ERROR_MESSAGE_MAP.state_mismatch);
      redirectToHome("state_mismatch");
      return;
    }

    redirectToHome();
  }, []);

  return (
    <main className="newsroom-shell">
      <section className="newsroom-hero">
        <p className="eyebrow">Unified Auth</p>
        <h1>登录处理中</h1>
        <p className="hero-meta">{statusText}</p>
      </section>
    </main>
  );
}
