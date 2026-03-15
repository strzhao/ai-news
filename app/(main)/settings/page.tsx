"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { fetchAuthUser } from "@/lib/client/auth";
import { fetchFlomoData, saveFlomoWebhook } from "@/lib/client/flomo";
import type { AuthUser, FlomoClickStats, FlomoConfig, FlomoPushStats, EmailNotifyConfig } from "@/lib/client/types";

function formatPushTime(value: string): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    hour12: false,
    timeZone: "Asia/Shanghai",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export default function SettingsPage(): React.ReactNode {
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [flomoConfig, setFlomoConfig] = useState<FlomoConfig | null>(null);
  const [flomoConfigLoaded, setFlomoConfigLoaded] = useState(false);
  const [flomoWebhookInput, setFlomoWebhookInput] = useState("");
  const [flomoEditing, setFlomoEditing] = useState(false);
  const [flomoSaving, setFlomoSaving] = useState(false);
  const [flomoMessage, setFlomoMessage] = useState<{ text: string; type: "success" | "error" } | null>(null);
  const [flomoPushStats, setFlomoPushStats] = useState<FlomoPushStats>({ total: 0, recent: [] });
  const [flomoClickStats, setFlomoClickStats] = useState<FlomoClickStats>({ total_clicks: 0, days: 30, daily: [] });
  const [emailNotify, setEmailNotify] = useState<EmailNotifyConfig | null>(null);
  const [emailNotifyLoading, setEmailNotifyLoading] = useState(false);
  const [pushSupported, setPushSupported] = useState(false);
  const [pushEnabled, setPushEnabled] = useState(false);
  const [pushLoading, setPushLoading] = useState(false);
  const [pushMessage, setPushMessage] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const { user } = await fetchAuthUser();
      setAuthUser(user);
      setAuthChecked(true);
      if (!user) return;

      try {
        const data = await fetchFlomoData();
        setFlomoConfig(data.config);
        if (data.config) setFlomoWebhookInput(data.config.webhook_url);
        setFlomoPushStats(data.pushStats);
        setFlomoClickStats(data.clickStats);
      } catch {
        // silent
      } finally {
        setFlomoConfigLoaded(true);
      }

      try {
        const emailRes = await fetch("/api/v1/email-notify/config", { credentials: "include" });
        const emailPayload = (await emailRes.json()) as { ok: boolean; config?: EmailNotifyConfig };
        if (emailPayload.ok && emailPayload.config) {
          setEmailNotify(emailPayload.config);
        }
      } catch {
        // silent
      }

      try {
        const { isPushSupported } = await import("@/lib/client/web-push");
        if (isPushSupported()) {
          setPushSupported(true);
          const pushRes = await fetch("/api/v1/web-push/config", { credentials: "include" });
          const pushPayload = (await pushRes.json()) as { ok: boolean; config?: { enabled: boolean } };
          if (pushPayload.ok && pushPayload.config) {
            setPushEnabled(pushPayload.config.enabled);
          }
        }
      } catch {
        // silent
      }
    })();
  }, []);

  function switchAccount(): void {
    window.location.assign("/api/auth/login?prompt=select_account");
  }

  async function handleSaveWebhook(): Promise<void> {
    setFlomoSaving(true);
    setFlomoMessage(null);
    try {
      const result = await saveFlomoWebhook(flomoWebhookInput);
      if (!result.ok) {
        setFlomoMessage({ text: result.error || "保存失败", type: "error" });
        return;
      }
      setFlomoConfig(result.config || null);
      setFlomoEditing(false);
      setFlomoMessage({ text: "配置已保存", type: "success" });
    } catch {
      setFlomoMessage({ text: "网络错误，请重试", type: "error" });
    } finally {
      setFlomoSaving(false);
    }
  }

  if (!authChecked) {
    return <p className="settings-loading">加载中...</p>;
  }

  if (!authUser) {
    return (
      <>
        <div className="page-header">
          <h1 className="page-title">设置</h1>
        </div>
        <section className="settings-section">
          <p className="settings-empty">请先登录后访问设置页。</p>
          <Link href="/" className="flomo-btn" style={{ display: "inline-flex", textDecoration: "none" }}>
            返回首页
          </Link>
        </section>
      </>
    );
  }

  return (
    <>
      <div className="page-header">
        <h1 className="page-title">设置</h1>
      </div>

      <section className="settings-section">
        <header className="block-head">
          <h2>账号</h2>
        </header>
        <div className="settings-account-row">
          <span className="settings-account-email">{authUser.email}</span>
          <button type="button" className="flomo-btn flomo-btn-secondary" onClick={switchAccount}>
            切换账号
          </button>
        </div>
      </section>

      {flomoConfigLoaded ? (
        <section className="settings-section">
          <header className="block-head">
            <h2>Flomo 推送</h2>
          </header>

          <p className="flomo-description">
            配置后，系统会在每天 7:00 和 19:00 自动将当日精选 AI 文章摘要推送到你的 Flomo。
            内容包含文章标题、摘要和原文链接，方便稍后阅读。
          </p>

          {!flomoConfig || flomoEditing ? (
            <div className="flomo-config-form">
              <div className="flomo-config-row">
                <input
                  className="flomo-input"
                  type="url"
                  placeholder="https://flomoapp.com/iwh/xxx/yyy/"
                  value={flomoWebhookInput}
                  onChange={(e) => setFlomoWebhookInput(e.target.value)}
                />
              </div>
              <p className="flomo-help-text">
                前往{" "}
                <a
                  href="https://v.flomoapp.com/mine/?source=incoming_webhook"
                  target="_blank"
                  rel="noreferrer noopener"
                >
                  v.flomoapp.com/mine
                </a>
                {" "}→ API &amp; Webhook → 复制你的 Webhook 地址
              </p>
              <div className="flomo-action-row">
                <button
                  type="button"
                  className="flomo-btn"
                  disabled={flomoSaving || !flomoWebhookInput.trim()}
                  onClick={() => void handleSaveWebhook()}
                >
                  {flomoSaving ? "保存中..." : "保存配置"}
                </button>
                {flomoEditing && flomoConfig ? (
                  <button
                    type="button"
                    className="flomo-btn flomo-btn-secondary"
                    onClick={() => {
                      setFlomoEditing(false);
                      setFlomoWebhookInput(flomoConfig.webhook_url);
                      setFlomoMessage(null);
                    }}
                  >
                    取消
                  </button>
                ) : null}
              </div>
            </div>
          ) : (
            <div className="flomo-configured-info">
              <div className="flomo-configured-row">
                <span className="flomo-webhook-display">
                  已配置: {flomoConfig.webhook_url_masked}
                </span>
                <button
                  type="button"
                  className="flomo-btn flomo-btn-secondary"
                  onClick={() => setFlomoEditing(true)}
                >
                  修改配置
                </button>
              </div>
            </div>
          )}

          {flomoMessage ? (
            <div className={`flomo-message ${flomoMessage.type === "success" ? "is-success" : "is-error"}`}>
              {flomoMessage.text}
            </div>
          ) : null}
        </section>
      ) : null}

      {emailNotify ? (
        <section className="settings-section">
          <header className="block-head">
            <h2>邮件通知</h2>
          </header>
          <p className="flomo-description">
            URL 资源提取完成后，结果将通过邮件发送到你的登录邮箱。
          </p>
          <div className="email-notify-row">
            <button
              type="button"
              className={`email-notify-toggle${emailNotify.enabled ? " is-enabled" : ""}`}
              disabled={emailNotifyLoading}
              onClick={async () => {
                setEmailNotifyLoading(true);
                try {
                  const res = await fetch("/api/v1/email-notify/config", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    credentials: "include",
                    body: JSON.stringify({ enabled: !emailNotify.enabled }),
                  });
                  const payload = (await res.json()) as { ok: boolean; config?: EmailNotifyConfig };
                  if (payload.ok && payload.config) {
                    setEmailNotify(payload.config);
                  }
                } catch {
                  // silent
                } finally {
                  setEmailNotifyLoading(false);
                }
              }}
            />
            <span className="email-notify-label">
              {emailNotify.enabled ? "已开启" : "已关闭"}
            </span>
            <span className="email-notify-email">{emailNotify.email}</span>
          </div>
        </section>
      ) : null}

      {pushSupported ? (
        <section className="settings-section">
          <header className="block-head">
            <h2>浏览器推送</h2>
          </header>
          <p className="flomo-description">
            开启后，系统会在每天 7:00 和 19:00 通过浏览器推送通知提醒你查看当日精选 AI 文章。
          </p>
          <div className="email-notify-row">
            <button
              type="button"
              className={`email-notify-toggle${pushEnabled ? " is-enabled" : ""}`}
              disabled={pushLoading}
              onClick={async () => {
                setPushLoading(true);
                setPushMessage(null);
                try {
                  if (!pushEnabled) {
                    const perm = await Notification.requestPermission();
                    if (perm !== "granted") {
                      setPushMessage("请在浏览器设置中允许通知权限");
                      return;
                    }
                    const { subscribeToPush } = await import("@/lib/client/web-push");
                    const ok = await subscribeToPush();
                    if (ok) {
                      setPushEnabled(true);
                    } else {
                      setPushMessage("订阅失败，请重试");
                    }
                  } else {
                    const { unsubscribeFromPush } = await import("@/lib/client/web-push");
                    await unsubscribeFromPush();
                    setPushEnabled(false);
                  }
                } catch {
                  setPushMessage("操作失败，请重试");
                } finally {
                  setPushLoading(false);
                }
              }}
            />
            <span className="email-notify-label">
              {pushEnabled ? "已开启" : "已关闭"}
            </span>
          </div>
          {pushMessage ? (
            <div className="flomo-message is-error" style={{ marginTop: 8 }}>
              {pushMessage}
            </div>
          ) : null}
        </section>
      ) : null}

      {flomoConfigLoaded && (flomoPushStats.total > 0 || flomoClickStats.total_clicks > 0) ? (
        <section className="settings-section">
          <header className="block-head">
            <h2>使用统计</h2>
          </header>
          <div className="stats-cards">
            <div className="stats-card">
              <span className="stats-card-value">{flomoPushStats.total}</span>
              <span className="stats-card-label">总推送</span>
            </div>
            <div className="stats-card">
              <span className="stats-card-value">{flomoClickStats.total_clicks}</span>
              <span className="stats-card-label">总点击</span>
            </div>
            <div className="stats-card">
              <span className="stats-card-value">
                {(() => {
                  const totalArticles = flomoPushStats.recent.reduce((sum, e) => sum + e.article_count, 0);
                  if (!totalArticles) return "-";
                  return (flomoClickStats.total_clicks / totalArticles).toFixed(1);
                })()}
              </span>
              <span className="stats-card-label">篇均点击</span>
            </div>
          </div>
          {(() => {
            const last7 = flomoClickStats.daily.slice(0, 7);
            const maxClicks = Math.max(...last7.map((d) => d.clicks), 1);
            if (!last7.some((d) => d.clicks > 0)) return null;
            return (
              <div className="stats-sparkline">
                <span className="stats-sparkline-label">最近 7 天</span>
                <div className="stats-sparkline-bars">
                  {last7.map((d) => (
                    <div
                      key={d.date}
                      className="stats-sparkline-bar"
                      style={{ height: `${Math.max(4, (d.clicks / maxClicks) * 32)}px` }}
                      title={`${d.date}: ${d.clicks} 次点击`}
                    />
                  ))}
                </div>
              </div>
            );
          })()}
        </section>
      ) : null}

      {flomoConfigLoaded && flomoPushStats.total > 0 ? (
        <section className="settings-section">
          <header className="block-head">
            <h2>推送记录</h2>
            <span>共 {flomoPushStats.total} 次</span>
          </header>
          <div className="push-log-list">
            {flomoPushStats.recent.map((entry, i) => (
              <div key={`${entry.date}-${entry.pushed_at}-${i}`} className="push-log-item">
                <span className="push-log-date">{entry.date}</span>
                <span className="push-log-count">{entry.article_count} 篇文章</span>
                <span className="push-log-time">{formatPushTime(entry.pushed_at)}</span>
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </>
  );
}
