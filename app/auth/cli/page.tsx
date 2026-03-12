"use client";

import { useEffect, useState } from "react";

type Status = "authorizing" | "success" | "error";

export default function CLIAuthPage() {
  const [status, setStatus] = useState<Status>("authorizing");
  const [message, setMessage] = useState("正在授权 CLI...");

  useEffect(() => {
    let cancelled = false;

    async function authorize() {
      const params = new URLSearchParams(window.location.search);
      const port = params.get("port");
      const state = params.get("state");

      if (!port || !state) {
        if (!cancelled) {
          setStatus("error");
          setMessage("缺少必要参数 (port, state)，请通过 CLI 发起登录。");
        }
        return;
      }

      try {
        const tokenRes = await fetch("/api/auth/cli-token", { method: "POST" });
        if (!tokenRes.ok) {
          if (!cancelled) {
            setStatus("error");
            setMessage("获取凭证失败，请先在浏览器登录 AI News 后重试。");
          }
          return;
        }

        const { access_token, user_id, email } = await tokenRes.json();

        const callbackRes = await fetch(`http://localhost:${port}/callback`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ access_token, user_id, email, state }),
        });

        if (!callbackRes.ok) {
          if (!cancelled) {
            setStatus("error");
            setMessage("无法将凭证发送给 CLI，请确认 CLI 仍在运行。");
          }
          return;
        }

        if (!cancelled) {
          setStatus("success");
          setMessage(`授权成功 (${email})，可以关闭此页面。`);
        }
      } catch {
        if (!cancelled) {
          setStatus("error");
          setMessage("授权过程出错，请确认 CLI 仍在运行后重试。");
        }
      }
    }

    void authorize();
    return () => { cancelled = true; };
  }, []);

  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh" }}>
      <div style={{ textAlign: "center", maxWidth: 360, padding: 24 }}>
        <h1 style={{ fontSize: 24, fontWeight: 650, marginBottom: 12 }}>AI News CLI</h1>
        <p style={{ color: "var(--muted)", fontSize: 14, marginBottom: 16 }}>{message}</p>
        {status === "authorizing" && (
          <p style={{ fontSize: 13, color: "var(--muted)" }}>请稍候...</p>
        )}
        {status === "success" && (
          <p style={{ fontSize: 13, color: "#16a34a" }}>已完成，可安全关闭此窗口。</p>
        )}
        {status === "error" && (
          <p style={{ fontSize: 13, color: "#dc2626" }}>请在终端运行 `ai-news login` 重试。</p>
        )}
      </div>
    </div>
  );
}
