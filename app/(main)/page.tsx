"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";

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
  const [readSet, setReadSet] = useState<Set<string>>(new Set());
  const [days, setDays] = useState(30);
  const [limitPerDay, setLimitPerDay] = useState(10);
  const [articleLimitPerDay, setArticleLimitPerDay] = useState(0);

  const [summaryDrawerOpen, setSummaryDrawerOpen] = useState(false);
  const [summaryArticle, setSummaryArticle] = useState<ArchiveArticleSummary | null>(null);
  const [summaryMarkdown, setSummaryMarkdown] = useState("");
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryError, setSummaryError] = useState("");
  const summaryPollRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const summaryAutoOpenedRef = useRef(false);

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
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadArchiveArticles(): Promise<void> {
      setLoading(true);
      setError("");
      try {
        const response = await fetch(
          `/api/archive_articles?days=${days}&limit_per_day=${limitPerDay}&article_limit_per_day=${articleLimitPerDay}&image_probe_limit=0`,
          { cache: "no-store" },
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

  const closeSummaryDrawer = useCallback(() => {
    setSummaryDrawerOpen(false);
    setSummaryArticle(null);
    setSummaryMarkdown("");
    setSummaryLoading(false);
    setSummaryError("");
    if (summaryPollRef.current) {
      clearTimeout(summaryPollRef.current);
      summaryPollRef.current = null;
    }

    // 清除 URL 参数
    const url = new URL(window.location.href);
    if (url.searchParams.has("summary")) {
      url.searchParams.delete("summary");
      window.history.replaceState(null, "", url.toString());
    }
  }, []);

  const fetchSummary = useCallback(async (articleId: string, pollCount = 0) => {
    try {
      const response = await fetch(`/api/article_summary/${encodeURIComponent(articleId)}`, { cache: "no-store" });
      const data = await response.json();

      if (!data.ok) {
        setSummaryError(data.error || "获取总结失败");
        setSummaryLoading(false);
        return;
      }

      if (data.status === "completed" && data.summary_markdown) {
        setSummaryMarkdown(data.summary_markdown);
        setSummaryLoading(false);
        return;
      }

      if (data.status === "no_content") {
        setSummaryError("文章内容不足，无法生成 AI 总结");
        setSummaryLoading(false);
        return;
      }

      if (data.status === "failed") {
        setSummaryError(data.error || "AI 总结生成失败，请稍后重试");
        setSummaryLoading(false);
        return;
      }

      // status === "generating", keep polling
      if (pollCount < 60) {
        summaryPollRef.current = setTimeout(() => {
          void fetchSummary(articleId, pollCount + 1);
        }, 5000);
      } else {
        setSummaryError("总结生成超时，请稍后重试");
        setSummaryLoading(false);
      }
    } catch (err) {
      setSummaryError(err instanceof Error ? err.message : "网络错误");
      setSummaryLoading(false);
    }
  }, []);

  function handleOpenSummary(item: ArchiveArticleSummary): void {
    if (summaryPollRef.current) {
      clearTimeout(summaryPollRef.current);
      summaryPollRef.current = null;
    }
    setSummaryArticle(item);
    setSummaryMarkdown("");
    setSummaryError("");
    setSummaryLoading(true);
    setSummaryDrawerOpen(true);
    void fetchSummary(item.article_id);

    // 写入 URL 参数，不刷新页面
    const url = new URL(window.location.href);
    url.searchParams.set("summary", item.article_id);
    window.history.pushState(null, "", url.toString());
  }

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent): void {
      if (e.key === "Escape" && summaryDrawerOpen) {
        closeSummaryDrawer();
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [summaryDrawerOpen, closeSummaryDrawer]);

  useEffect(() => {
    return () => {
      if (summaryPollRef.current) {
        clearTimeout(summaryPollRef.current);
      }
    };
  }, []);

  // 页面加载时检查 URL 参数，自动打开对应的 AI 总结
  useEffect(() => {
    if (loading || groups.length === 0 || summaryAutoOpenedRef.current) return;

    const params = new URLSearchParams(window.location.search);
    const summaryId = params.get("summary");
    if (!summaryId) return;

    // 在所有 groups 中查找对应文章
    for (const group of groups) {
      const found = group.items.find((item) => item.article_id === summaryId);
      if (found) {
        summaryAutoOpenedRef.current = true;
        // 内联 handleOpenSummary 逻辑
        if (summaryPollRef.current) clearTimeout(summaryPollRef.current);
        setSummaryArticle(found);
        setSummaryMarkdown("");
        setSummaryError("");
        setSummaryLoading(true);
        setSummaryDrawerOpen(true);
        void fetchSummary(found.article_id);
        return;
      }
    }
  }, [loading, groups, fetchSummary]);

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
            <button
              type="button"
              className="article-cta"
              onClick={() => handleOpenSummary(item)}
            >
              AI 总结
            </button>
          </div>
        </div>
      </article>
    );
  }

  return (
    <>
      <div className="page-header">
        <h1 className="page-title">今天值得读的 AI 文章</h1>
        <p className="page-meta">
          {todayDate} · {ARCHIVE_TZ} · {loading ? "正在更新" : status}
        </p>
      </div>

      {authError ? <div className="error-banner auth-error-banner">{authError}</div> : null}
      {error ? <div className="error-banner">{error}</div> : null}

      <section className="content-block">
        <header className="block-head">
          <h2>今日精选</h2>
          <span className="block-head-actions">
            <span>{todayItems.length} 篇</span>
          </span>
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
        <p className="page-meta">
          <a href="/archive-review">进入归档审查页（完整列表 + 好/不好反馈）</a>
        </p>
      </section>

      {summaryDrawerOpen && summaryArticle ? (
        <>
          <div className="drawer-overlay" onClick={closeSummaryDrawer} />
          <div className="drawer-panel" role="dialog" aria-modal="true">
            <button type="button" className="drawer-close" onClick={closeSummaryDrawer}>
              ✕
            </button>

            <h2 className="summary-drawer-title">{summaryArticle.title}</h2>
            <div className="summary-drawer-meta">
              <span>{summaryArticle.source_host || "未知来源"}</span>
              <span> · </span>
              <span>{formatTime(summaryArticle.generated_at)}</span>
            </div>

            {summaryLoading ? (
              <div className="analyze-pending">
                <div className="analyze-spinner" />
                <p className="analyze-pending-text">正在生成 AI 总结...</p>
                <p className="analyze-pending-hint">通常需要 30-60 秒，请稍候</p>
              </div>
            ) : null}

            {summaryError ? (
              <div className="error-banner" style={{ marginTop: 20 }}>
                {summaryError}
              </div>
            ) : null}

            {summaryMarkdown ? (
              <div className="summary-content">
                <ReactMarkdown
                  components={{
                    a: ({ children, href, ...props }) => (
                      <a href={href} target="_blank" rel="noreferrer noopener" {...props}>
                        {children}
                      </a>
                    ),
                  }}
                >
                  {summaryMarkdown}
                </ReactMarkdown>
              </div>
            ) : null}

            <div className="summary-drawer-footer">
              <a
                className="article-cta"
                href={summaryArticle.original_url || summaryArticle.url}
                target="_blank"
                rel="noreferrer noopener"
              >
                阅读原文
              </a>
            </div>
          </div>
        </>
      ) : null}
    </>
  );
}
