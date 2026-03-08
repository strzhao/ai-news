"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import {
  AUTH_STATE_STORAGE_KEY,
  buildAuthorizeUrlForCurrentOrigin,
  generateAuthState,
} from "@/lib/auth-config";
import { fetchAuthUser } from "@/lib/client/auth";
import { fetchFlomoData, triggerFlomoPush } from "@/lib/client/flomo";
import type { AuthUser, FlomoConfig } from "@/lib/client/types";

const ARCHIVE_TZ = "Asia/Shanghai";
const READ_STORAGE_KEY = "ai_news_read_article_ids_v1";
const TODAY_PAGE_SIZE = 10;
const LIMIT_PER_DAY_MAX = 200;
const AUTH_ERROR_MESSAGES: Record<string, string> = {
  state_mismatch: "登录状态校验失败，请重新发起登录。",
  authorization_not_completed: "授权未完成，请重试。",
};

interface ArchiveArticleSummary {
  article_id: string;
  title: string;
  url: string;
  original_url: string;
  summary: string;
  image_url: string;
  source_host: string;
  date: string;
  digest_id: string;
  generated_at: string;
}

interface ArchiveGroup {
  date: string;
  items: ArchiveArticleSummary[];
}

interface ArchiveArticlesResponse {
  ok: boolean;
  groups: ArchiveGroup[];
  has_more_by_date?: Record<string, boolean>;
  generated_at: string;
  total_articles: number;
}

const AUTH_LOGIN_JUST_COMPLETED_KEY = "auth_login_just_completed";

function formatTime(value: string): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    hour12: false,
    timeZone: ARCHIVE_TZ,
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function currentDateInTz(): string {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: ARCHIVE_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const [{ value: year }, , { value: month }, , { value: day }] = formatter.formatToParts(new Date());
  return `${year}-${month}-${day}`;
}

function loadReadSet(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(READ_STORAGE_KEY);
    if (!raw) return new Set();
    const list = JSON.parse(raw);
    if (!Array.isArray(list)) return new Set();
    return new Set(list.map((item) => String(item || "").trim()).filter(Boolean));
  } catch {
    return new Set();
  }
}

function saveReadSet(set: Set<string>): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(READ_STORAGE_KEY, JSON.stringify(Array.from(set)));
}

interface RenderOptions {
  compact?: boolean;
  lead?: boolean;
}

export default function HomePage(): React.ReactNode {
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState("正在更新");
  const [groups, setGroups] = useState<ArchiveGroup[]>([]);
  const [hasMoreByDate, setHasMoreByDate] = useState<Record<string, boolean>>({});
  const [error, setError] = useState("");
  const [authError, setAuthError] = useState("");
  const [authRuntimeError, setAuthRuntimeError] = useState("");
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [readSet, setReadSet] = useState<Set<string>>(new Set());
  const [flomoConfig, setFlomoConfig] = useState<FlomoConfig | null>(null);
  const [flomoConfigLoaded, setFlomoConfigLoaded] = useState(false);
  const [flomoPushing, setFlomoPushing] = useState(false);
  const [flomoMessage, setFlomoMessage] = useState<{ text: string; type: "success" | "error" } | null>(null);
  const [days, setDays] = useState(30);
  const [limitPerDay, setLimitPerDay] = useState(10);
  const [articleLimitPerDay, setArticleLimitPerDay] = useState(0);

  const refreshAuthUser = useCallback(async (showError = false): Promise<boolean> => {
    const { user, error } = await fetchAuthUser();
    setAuthUser(user);
    if (error && showError) setAuthRuntimeError(error);
    if (user) setAuthRuntimeError("");
    return !!user;
  }, []);

  const loadFlomoData = useCallback(async () => {
    try {
      const data = await fetchFlomoData();
      setFlomoConfig(data.config);
    } catch {
      // silent
    } finally {
      setFlomoConfigLoaded(true);
    }
  }, []);

  async function pushToFlomo(): Promise<void> {
    setFlomoPushing(true);
    setFlomoMessage(null);
    try {
      const payload = await triggerFlomoPush();
      if (!payload.ok) {
        setFlomoMessage({ text: payload.error || "推送失败", type: "error" });
        return;
      }
      if (!payload.sent) {
        setFlomoMessage({ text: "暂无可推送的文章", type: "success" });
        return;
      }
      setFlomoMessage({
        text: `已推送 ${payload.article_count} 篇文章到 Flomo（今日剩余 ${payload.daily_remaining} 次）`,
        type: "success",
      });
    } catch {
      setFlomoMessage({ text: "网络错误，请重试", type: "error" });
    } finally {
      setFlomoPushing(false);
    }
  }

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setDays(Math.max(1, Math.min(180, Number.parseInt(params.get("days") || "30", 10) || 30)));
    setLimitPerDay(
      Math.max(1, Math.min(LIMIT_PER_DAY_MAX, Number.parseInt(params.get("limit_per_day") || "10", 10) || 10)),
    );
    setArticleLimitPerDay(
      Math.max(0, Math.min(5000, Number.parseInt(params.get("article_limit_per_day") || "0", 10) || 0)),
    );
    setReadSet(loadReadSet());
    const authErrorCode = params.get("auth_error") ?? "";
    setAuthError(authErrorCode ? AUTH_ERROR_MESSAGES[authErrorCode] ?? "登录流程异常，请重试。" : "");
    const justCompleted =
      (typeof window !== "undefined" && window.sessionStorage.getItem(AUTH_LOGIN_JUST_COMPLETED_KEY) === "1") || false;

    if (justCompleted && typeof window !== "undefined") {
      window.sessionStorage.removeItem(AUTH_LOGIN_JUST_COMPLETED_KEY);
      void (async () => {
        for (let attempt = 0; attempt < 3; attempt += 1) {
          const ok = await refreshAuthUser(attempt > 0);
          if (ok) {
            void loadFlomoData();
            return;
          }
          await new Promise((resolve) => setTimeout(resolve, 400 * (attempt + 1)));
        }
      })();
      return;
    }

    void (async () => {
      const ok = await refreshAuthUser();
      if (ok) void loadFlomoData();
    })();
  }, [refreshAuthUser, loadFlomoData]);

  useEffect(() => {
    let cancelled = false;

    async function loadArchiveArticles(): Promise<void> {
      setLoading(true);
      setError("");
      try {
        const response = await fetch(
          `/api/archive_articles?days=${days}&limit_per_day=${limitPerDay}&article_limit_per_day=${articleLimitPerDay}&image_probe_limit=0`,
          {
            cache: "no-store",
          },
        );
        const payload = (await response.json()) as ArchiveArticlesResponse;
        if (!response.ok || !payload.ok) {
          throw new Error("加载文章归档失败");
        }

        if (!cancelled) {
          const nextGroups = Array.isArray(payload.groups) ? payload.groups : [];
          const nextHasMoreByDate =
            payload.has_more_by_date && typeof payload.has_more_by_date === "object" ? payload.has_more_by_date : {};
          setGroups(nextGroups);
          setHasMoreByDate(nextHasMoreByDate);
          const count = Number(payload.total_articles || 0);
          setStatus(`已收录 ${count} 篇`);
        }
      } catch (err) {
        if (!cancelled) {
          const message = err instanceof Error ? err.message : String(err);
          setError(message);
          setStatus("加载失败");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void loadArchiveArticles();
    return () => {
      cancelled = true;
    };
  }, [days, limitPerDay, articleLimitPerDay]);

  const todayDate = useMemo(() => currentDateInTz(), []);

  const todayGroup = useMemo(
    () => groups.find((group) => String(group.date || "").trim() === todayDate) || null,
    [groups, todayDate],
  );

  const todayItems = useMemo(() => todayGroup?.items || [], [todayGroup]);
  const hasMoreTodayItems = !loading && Boolean(hasMoreByDate[todayDate]);
  const historyGroups = groups.filter((group) => group.date !== todayDate);

  function startUnifiedLogin(): void {
    setAuthRuntimeError("");
    const state = generateAuthState();
    try {
      window.sessionStorage.setItem(AUTH_STATE_STORAGE_KEY, state);
    } catch {
      // Ignore storage failures, callback will reject mismatched state.
    }

    const authorizeUrl = buildAuthorizeUrlForCurrentOrigin(state);
    window.location.assign(authorizeUrl);
  }

  function markArticleRead(articleId: string): void {
    const normalized = String(articleId || "").trim();
    if (!normalized) return;
    setReadSet((prev) => {
      if (prev.has(normalized)) return prev;
      const next = new Set(prev);
      next.add(normalized);
      saveReadSet(next);
      return next;
    });
  }

  function renderArticle(item: ArchiveArticleSummary, options: RenderOptions = {}): React.ReactNode {
    const articleId = String(item.article_id || "").trim();
    const read = readSet.has(articleId);
    const articleUrl = item.original_url || item.url;

    return (
      <article
        key={articleId}
        className={`article-row${read ? " is-read" : ""}${options.compact ? " is-compact" : ""}${options.lead ? " is-lead" : ""}`}
      >
        <div className="article-copy">
          <div className="article-meta">
            <span>{item.source_host || "未知来源"}</span>
            <span>{formatTime(item.generated_at)}</span>
            {read ? <span className="article-read">已读</span> : null}
          </div>

          <h3 className="article-headline">
            <a
              href={articleUrl}
              target="_blank"
              rel="noreferrer noopener"
              onClick={() => markArticleRead(articleId)}
            >
              {item.title || "无标题"}
            </a>
          </h3>

          {item.summary ? <p className="article-dek">{item.summary}</p> : null}

          <div className="article-actions">
            <a
              className="article-cta"
              href={articleUrl}
              target="_blank"
              rel="noreferrer noopener"
              onClick={() => markArticleRead(articleId)}
            >
              阅读原文
            </a>
          </div>
        </div>
      </article>
    );
  }

  return (
    <main className="newsroom-shell">
      <header className="newsroom-hero">
        <div className="hero-topbar">
          <p className="eyebrow">AI News Daily Edition</p>
          <div className="hero-auth-corner">
            <div className="hero-auth-row">
              {authUser ? (
                <Link href="/settings" className="auth-user-chip">
                  {authUser.email}
                </Link>
              ) : (
                <button type="button" className="auth-login-btn" onClick={startUnifiedLogin}>
                  统一账号登录
                </button>
              )}
            </div>
          </div>
        </div>
        <h1>今天值得读的 AI 文章</h1>
        <p className="hero-meta">
          {todayDate} · {ARCHIVE_TZ} · {loading ? "正在更新" : status}
        </p>
      </header>

      {authError ? <div className="error-banner auth-error-banner">{authError}</div> : null}
      {authRuntimeError ? <div className="error-banner auth-error-banner">{authRuntimeError}</div> : null}
      {error ? <div className="error-banner">{error}</div> : null}

      <section className="content-block">
        <header className="block-head">
          <h2>今日精选</h2>
          <span className="block-head-actions">
            {authUser && flomoConfig ? (
              <button
                type="button"
                className="flomo-push-btn"
                disabled={flomoPushing}
                onClick={() => void pushToFlomo()}
              >
                {flomoPushing ? "推送中..." : "推送到 Flomo"}
              </button>
            ) : null}
            {authUser && flomoConfigLoaded && !flomoConfig ? (
              <Link href="/settings" className="flomo-setup-link">配置 Flomo</Link>
            ) : null}
            <span>{todayItems.length} 篇</span>
          </span>
        </header>

        {flomoMessage ? (
          <div className={`flomo-message ${flomoMessage.type === "success" ? "is-success" : "is-error"}`}>
            {flomoMessage.text}
          </div>
        ) : null}

        <div className="editorial-list">
          {todayItems.length ? (
            todayItems.map((item, index) => renderArticle(item, { lead: index === 0 }))
          ) : (
            <p className="empty-note">今日暂无文章。</p>
          )}
        </div>
        {todayItems.length ? (
          <div className="load-more-wrap">
            <button
              type="button"
              className="load-more-btn"
              onClick={() => setLimitPerDay((prev) => Math.min(LIMIT_PER_DAY_MAX, prev + TODAY_PAGE_SIZE))}
              disabled={!hasMoreTodayItems || loading}
            >
              {loading ? "加载中..." : hasMoreTodayItems ? "查看更多" : "没有更多精选文章"}
            </button>
          </div>
        ) : null}
      </section>

      <section className="content-block content-block-history">
        <header className="block-head">
          <h2>历史归档</h2>
          <span>{historyGroups.length} 天</span>
        </header>

        <div className="archive-days">
          {historyGroups.length ? (
            historyGroups.map((group, idx) => (
              <details key={group.date} className="archive-day" open={idx === 0}>
                <summary className="archive-day-summary">
                  <span className="archive-date">{group.date}</span>
                  <span className="archive-count">{group.items.length} 篇</span>
                </summary>
                <div className="archive-day-items">{group.items.map((item) => renderArticle(item, { compact: true }))}</div>
              </details>
            ))
          ) : (
            <p className="empty-note">暂无历史文章。</p>
          )}
        </div>
      </section>

      <section className="content-block">
        <p className="hero-meta">
          <a href="/archive-review">进入归档审查页（完整列表 + 好/不好反馈）</a>
        </p>
      </section>
    </main>
  );
}
