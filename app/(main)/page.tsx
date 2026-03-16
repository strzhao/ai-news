"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { DailyEditorial } from "@/lib/llm/editorial";
import { fetchAuthUser } from "@/lib/client/auth";
import { fetchHeartedIds, toggleHeart as toggleHeartApi } from "@/lib/client/hearts";
import type { AuthUser } from "@/lib/client/types";
import { SummaryDrawer } from "@/app/components/summary-drawer";

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
  tag_groups: Record<string, string[]>;
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

/* ── Helpers ── */

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

function formatEditorialDate(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  if (Number.isNaN(d.getTime())) return dateStr;
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "long",
    timeZone: ARCHIVE_TZ,
  }).format(d);
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

function renderTags(tagGroups: Record<string, string[]>): React.ReactNode {
  if (!tagGroups || typeof tagGroups !== "object") return null;
  const chips: React.ReactNode[] = [];
  for (const groupKey of ["topic", "tech", "role", "scenario"]) {
    const tags = tagGroups[groupKey];
    if (!Array.isArray(tags)) continue;
    for (const tag of tags) {
      if (chips.length >= 5) break;
      chips.push(
        <span key={`${groupKey}-${tag}`} className="article-tag">
          {tag.replace(/_/g, " ")}
        </span>,
      );
    }
    if (chips.length >= 5) break;
  }
  return chips.length > 0 ? <div className="article-tags">{chips}</div> : null;
}

interface HeartableArticle {
  article_id: string;
  title: string;
  url: string;
  original_url?: string;
  source_host: string;
  image_url?: string;
  summary?: string;
}

/* ── Component ── */

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

  // Editorial state
  const [editorial, setEditorial] = useState<DailyEditorial | null>(null);
  const [editorialLoading, setEditorialLoading] = useState(true);

  // Summary drawer state
  const [summaryDrawerOpen, setSummaryDrawerOpen] = useState(false);
  const [summaryArticle, setSummaryArticle] = useState<ArchiveArticleSummary | null>(null);
  const summaryAutoOpenedRef = useRef(false);

  // Heart state
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [heartedIds, setHeartedIds] = useState<Set<string>>(new Set());

  const todayDate = useMemo(() => currentDateInTz(), []);

  // Init from URL params
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

  // Load editorial (parallel with articles)
  useEffect(() => {
    let cancelled = false;
    async function loadEditorial(): Promise<void> {
      try {
        const response = await fetch("/api/daily_editorial", { cache: "no-store" });
        const data = await response.json();
        if (!cancelled && data.ok && data.editorial) {
          setEditorial(data.editorial);
        }
      } catch {
        // Silently degrade
      } finally {
        if (!cancelled) setEditorialLoading(false);
      }
    }
    void loadEditorial();
    return () => { cancelled = true; };
  }, [todayDate]);

  // Load auth + hearted IDs
  useEffect(() => {
    let cancelled = false;
    async function loadHearts(): Promise<void> {
      const { user } = await fetchAuthUser();
      if (cancelled) return;
      setAuthUser(user);
      if (user) {
        const ids = await fetchHeartedIds();
        if (!cancelled) setHeartedIds(new Set(ids));
      }
    }
    void loadHearts();
    return () => { cancelled = true; };
  }, []);

  // Load articles
  useEffect(() => {
    let cancelled = false;
    async function loadArchiveArticles(): Promise<void> {
      setLoading(true);
      setError("");
      try {
        const response = await fetch(
          `/api/archive_articles?days=${days}&limit_per_day=${limitPerDay}&article_limit_per_day=${articleLimitPerDay}&image_probe_limit=5`,
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
        if (!cancelled) setLoading(false);
      }
    }
    void loadArchiveArticles();
    return () => { cancelled = true; };
  }, [days, limitPerDay, articleLimitPerDay]);

  const todayGroup = useMemo(
    () => groups.find((group) => String(group.date || "").trim() === todayDate) || null,
    [groups, todayDate],
  );
  const todayItems = useMemo(() => todayGroup?.items || [], [todayGroup]);
  const hasMoreTodayItems = !loading && Boolean(hasMoreByDate[todayDate]);
  const historyGroups = useMemo(() => groups.filter((group) => group.date !== todayDate), [groups, todayDate]);

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

  async function handleToggleHeart(item: HeartableArticle): Promise<void> {
    if (!authUser) {
      window.location.assign("/api/auth/login");
      return;
    }
    const articleId = item.article_id;
    const wasHearted = heartedIds.has(articleId);
    // Optimistic update
    setHeartedIds((prev) => {
      const next = new Set(prev);
      if (wasHearted) next.delete(articleId);
      else next.add(articleId);
      return next;
    });
    try {
      await toggleHeartApi(item);
    } catch {
      // Rollback
      setHeartedIds((prev) => {
        const next = new Set(prev);
        if (wasHearted) next.add(articleId);
        else next.delete(articleId);
        return next;
      });
    }
  }

  /* ── Summary Drawer ── */

  function handleOpenSummary(item: ArchiveArticleSummary): void {
    setSummaryArticle(item);
    setSummaryDrawerOpen(true);
    const url = new URL(window.location.href);
    url.searchParams.set("summary", item.article_id);
    window.history.pushState(null, "", url.toString());
  }

  // Auto-open summary from URL
  useEffect(() => {
    if (loading || groups.length === 0 || summaryAutoOpenedRef.current) return;
    const params = new URLSearchParams(window.location.search);
    const summaryId = params.get("summary");
    if (!summaryId) return;
    for (const group of groups) {
      const found = group.items.find((item) => item.article_id === summaryId);
      if (found) {
        summaryAutoOpenedRef.current = true;
        setSummaryArticle(found);
        setSummaryDrawerOpen(true);
        return;
      }
    }
  }, [loading, groups]);

  /* ── Render Helpers ── */

  function renderHeartButton(articleId: string, item: HeartableArticle): React.ReactNode {
    const hearted = heartedIds.has(articleId);
    return (
      <button
        type="button"
        className={`heart-btn${hearted ? " is-hearted" : ""}`}
        onClick={() => { void handleToggleHeart(item); }}
        aria-label={hearted ? "取消收藏" : "收藏"}
      >
        {hearted ? "♥" : "♡"}
      </button>
    );
  }

  function renderHeroArticle(item: ArchiveArticleSummary): React.ReactNode {
    const articleId = String(item.article_id || "").trim();
    const read = readSet.has(articleId);
    const articleUrl = item.original_url || item.url;

    return (
      <article key={articleId} className={`article-row hero-card${read ? " is-read" : ""}`}>
        {item.image_url ? (
          <div className="hero-image-wrap">
            <img
              src={item.image_url}
              alt=""
              className="hero-image"
              loading="eager"
              onError={(e) => { const wrap = (e.target as HTMLImageElement).parentElement; if (wrap) wrap.style.display = "none"; }}
            />
          </div>
        ) : null}
        <div className="article-copy">
          <div className="article-meta">
            <span className="article-number">01</span>
            <span>{item.source_host || "未知来源"}</span>
            <span>{formatTime(item.generated_at)}</span>
            {read ? <span className="article-read">已读</span> : null}
          </div>
          <h3 className="article-headline hero-headline">
            <a href={articleUrl} target="_blank" rel="noreferrer noopener" onClick={() => markArticleRead(articleId)}>
              {item.title || "无标题"}
            </a>
          </h3>
          {item.summary ? <p className="article-dek hero-dek">{item.summary}</p> : null}
          {renderTags(item.tag_groups)}
          <div className="article-actions">
            {renderHeartButton(articleId, item)}
            <button type="button" className="article-cta" onClick={() => handleOpenSummary(item)}>AI 总结</button>
          </div>
        </div>
      </article>
    );
  }

  function renderNumberedArticle(item: ArchiveArticleSummary, index: number, options: { compact?: boolean } = {}): React.ReactNode {
    const articleId = String(item.article_id || "").trim();
    const read = readSet.has(articleId);
    const articleUrl = item.original_url || item.url;
    const num = String(index + 1).padStart(2, "0");

    return (
      <article
        key={articleId}
        className={`article-row numbered-article${read ? " is-read" : ""}${options.compact ? " is-compact" : ""}`}
      >
        <div className="article-number-col">
          <span className="article-number">{num}</span>
        </div>
        <div className="article-copy">
          <div className="article-meta">
            <span>{item.source_host || "未知来源"}</span>
            <span>{formatTime(item.generated_at)}</span>
            {read ? <span className="article-read">已读</span> : null}
          </div>
          <h3 className="article-headline">
            <a href={articleUrl} target="_blank" rel="noreferrer noopener" onClick={() => markArticleRead(articleId)}>
              {item.title || "无标题"}
            </a>
          </h3>
          {item.summary ? <p className="article-dek">{item.summary}</p> : null}
          {renderTags(item.tag_groups)}
        </div>
        <div className="article-right-col">
          <div className="article-actions">
            {renderHeartButton(articleId, item)}
            <button type="button" className="article-cta" onClick={() => handleOpenSummary(item)}>AI 总结</button>
          </div>
        </div>
      </article>
    );
  }

  /* ── JSX ── */

  return (
    <>
      {/* ── Newsletter Header ── */}
      <div className="page-header newsletter-header">
        <p className="newsletter-date">{formatEditorialDate(todayDate)}</p>

        {editorialLoading ? (
          <div className="editorial-skeleton">
            <div className="skeleton-line skeleton-line-lg" />
            <div className="skeleton-line" />
            <div className="skeleton-line skeleton-line-sm" />
          </div>
        ) : editorial ? (
          <div className="editorial-card">
            <div className="editorial-byline">
              {editorial.edition ? (
                <span className="editorial-edition-label">
                  {{ morning: "晨报", noon: "午报", evening: "晚报" }[editorial.edition]}
                </span>
              ) : null}
              <span className="editorial-byline-label">主编</span>
              <span className="editorial-editor-name">{editorial.editor_name}</span>
              <span className="editorial-editor-title">{editorial.editor_title}</span>
            </div>
            <h1 className="page-title newsletter-title">{editorial.headline}</h1>
            <div className="editorial-body">
              {editorial.body_paragraphs.map((p, i) => (
                <p key={i}>{p}</p>
              ))}
            </div>
            {editorial.tags.length > 0 ? (
              <div className="editorial-tags">
                {editorial.tags.map((tag) => (
                  <span key={tag} className="editorial-tag">#{tag}</span>
                ))}
              </div>
            ) : null}
          </div>
        ) : (
          <h1 className="page-title newsletter-title">今天值得读的 AI 文章</h1>
        )}

        <p className="newsletter-subtitle">
          AI 领域精选日报 · {loading ? "正在更新..." : status}
        </p>
      </div>

      {authError ? <div className="error-banner auth-error-banner">{authError}</div> : null}
      {error ? <div className="error-banner">{error}</div> : null}

      {/* ── Today's Picks ── */}
      <section className="content-block">
        <header className="block-head">
          <h2>今日精选</h2>
          <span className="block-head-actions">
            {authUser ? (
              <button className="pick-submit-btn" onClick={() => window.dispatchEvent(new CustomEvent("url-submit-open"))}>
                + 收录文章
              </button>
            ) : null}
            <span>{todayItems.length} 篇精选</span>
          </span>
        </header>

        <div className="editorial-list">
          {todayItems.length ? (
            <>
              {renderHeroArticle(todayItems[0])}
              {todayItems.slice(1).map((item, i) => renderNumberedArticle(item, i + 1))}
            </>
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

      {/* ── History Archive ── */}
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
                <div className="archive-day-items">
                  {group.items.map((item, i) => renderNumberedArticle(item, i, { compact: true }))}
                </div>
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

      {/* ── Summary Drawer ── */}
      <SummaryDrawer
        article={summaryArticle ? {
          article_id: summaryArticle.article_id,
          title: summaryArticle.title,
          url: summaryArticle.url,
          original_url: summaryArticle.original_url,
          source_host: summaryArticle.source_host,
          generated_at: summaryArticle.generated_at,
        } : null}
        open={summaryDrawerOpen}
        onClose={() => {
          setSummaryDrawerOpen(false);
          setSummaryArticle(null);
          const url = new URL(window.location.href);
          if (url.searchParams.has("summary")) {
            url.searchParams.delete("summary");
            window.history.replaceState(null, "", url.toString());
          }
        }}
      />

    </>
  );
}
