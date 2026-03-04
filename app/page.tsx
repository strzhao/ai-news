"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import {
  AUTH_STATE_STORAGE_KEY,
  buildAuthLogoutUrl,
  buildAuthMeUrl,
  buildAuthorizeUrlForCurrentOrigin,
  generateAuthState,
} from "@/lib/auth-config";

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

interface AuthUser {
  id: string;
  email: string;
  status: string;
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

function firstNonEmptyString(...values: unknown[]): string {
  for (const value of values) {
    const normalized = String(value || "").trim();
    if (normalized) return normalized;
  }
  return "";
}

function extractAuthUser(payload: Record<string, unknown>): AuthUser | null {
  const nestedUser = payload.user && typeof payload.user === "object" ? (payload.user as Record<string, unknown>) : null;
  const dataUser =
    payload.data && typeof payload.data === "object"
      ? ((payload.data as Record<string, unknown>).user as Record<string, unknown> | undefined) || null
      : null;

  const id = firstNonEmptyString(
    payload.id,
    payload.user_id,
    payload.sub,
    nestedUser?.id,
    nestedUser?.user_id,
    nestedUser?.sub,
    dataUser?.id,
    dataUser?.user_id,
    dataUser?.sub,
  );
  const email = firstNonEmptyString(payload.email, nestedUser?.email, dataUser?.email);
  const status = firstNonEmptyString(payload.status, nestedUser?.status, dataUser?.status, "ACTIVE");

  if (!id || !email) return null;
  return { id, email, status };
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
  const [authActionPending, setAuthActionPending] = useState(false);
  const [readSet, setReadSet] = useState<Set<string>>(new Set());
  const [days, setDays] = useState(30);
  const [limitPerDay, setLimitPerDay] = useState(10);
  const [articleLimitPerDay, setArticleLimitPerDay] = useState(0);

  const refreshAuthUser = useCallback(async (showError = false): Promise<boolean> => {
    try {
      const response = await fetch(buildAuthMeUrl(), {
        cache: "no-store",
        credentials: "include",
      });
      if (response.status === 401) {
        setAuthUser(null);
        if (showError) {
          setAuthRuntimeError("");
        }
        return false;
      }

      const payload = (await response.json()) as Record<string, unknown>;
      if (!response.ok) {
        setAuthUser(null);
        if (showError) {
          setAuthRuntimeError("登录状态读取失败，请稍后重试。");
        }
        return false;
      }

      const user = extractAuthUser(payload);
      if (!user) {
        setAuthUser(null);
        if (showError || response.ok) {
          setAuthRuntimeError("登录状态异常，请重新登录。");
        }
        return false;
      }

      setAuthUser(user);
      setAuthRuntimeError("");
      return true;
    } catch {
      setAuthUser(null);
      if (showError) {
        setAuthRuntimeError("统一账号服务暂不可用，请稍后重试。");
      }
      return false;
    }
  }, []);

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
          if (ok) return;
          await new Promise((resolve) => setTimeout(resolve, 400 * (attempt + 1)));
        }
      })();
      return;
    }

    void refreshAuthUser();
  }, [refreshAuthUser]);

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

  async function logoutUnifiedAccount(): Promise<void> {
    setAuthActionPending(true);
    setAuthRuntimeError("");
    try {
      await fetch(buildAuthLogoutUrl(), {
        method: "POST",
        credentials: "include",
      });
    } catch {
      setAuthRuntimeError("退出登录失败，请稍后重试。");
    } finally {
      await refreshAuthUser(true);
      setAuthActionPending(false);
    }
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
              href={item.url}
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
              href={item.url}
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
        <p className="eyebrow">AI News Daily Edition</p>
        <h1>今天值得读的 AI 文章</h1>
        <p className="hero-meta">
          {todayDate} · {ARCHIVE_TZ} · {loading ? "正在更新" : status}
        </p>
        <div className="hero-auth-row">
          {authUser ? (
            <div className="auth-session-row">
              <span className="auth-user-chip">已登录 · {authUser.email}</span>
              <button
                type="button"
                className="auth-logout-btn"
                onClick={() => {
                  void logoutUnifiedAccount();
                }}
                disabled={authActionPending}
              >
                {authActionPending ? "处理中..." : "退出登录"}
              </button>
            </div>
          ) : (
            <button type="button" className="auth-login-btn" onClick={startUnifiedLogin}>
              使用统一账号登录
            </button>
          )}
        </div>
      </header>

      {authError ? <div className="error-banner auth-error-banner">{authError}</div> : null}
      {authRuntimeError ? <div className="error-banner auth-error-banner">{authRuntimeError}</div> : null}
      {error ? <div className="error-banner">{error}</div> : null}

      <section className="content-block">
        <header className="block-head">
          <h2>今日精选</h2>
          <span>{todayItems.length} 篇</span>
        </header>

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
