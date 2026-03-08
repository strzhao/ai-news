"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import {
  AUTH_STATE_STORAGE_KEY,
  buildAuthorizeUrlForCurrentOrigin,
  generateAuthState,
} from "@/lib/auth-config";
import { fetchAuthUser } from "@/lib/client/auth";
import { fetchFlomoData, saveFlomoWebhook } from "@/lib/client/flomo";
import type { AuthUser, FlomoConfig, FlomoPushStats } from "@/lib/client/types";

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
      } catch {
        // silent
      } finally {
        setFlomoConfigLoaded(true);
      }
    })();
  }, []);

  function switchAccount(): void {
    const state = generateAuthState();
    try {
      window.sessionStorage.setItem(AUTH_STATE_STORAGE_KEY, state);
    } catch {}
    const authorizeUrl = buildAuthorizeUrlForCurrentOrigin(state, "select_account");
    window.location.assign(authorizeUrl);
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
    return (
      <main className="newsroom-shell">
        <p className="settings-loading">加载中...</p>
      </main>
    );
  }

  if (!authUser) {
    return (
      <main className="newsroom-shell">
        <div className="settings-header">
          <Link href="/" className="settings-back-link">← 返回</Link>
          <h1>设置</h1>
        </div>
        <section className="settings-section">
          <p className="settings-empty">请先登录后访问设置页。</p>
          <Link href="/" className="flomo-btn" style={{ display: "inline-flex", textDecoration: "none" }}>
            返回首页
          </Link>
        </section>
      </main>
    );
  }

  return (
    <main className="newsroom-shell">
      <div className="settings-header">
        <Link href="/" className="settings-back-link">← 返回</Link>
        <h1>设置</h1>
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
    </main>
  );
}
