"use client";

import { useEffect, useMemo, useState } from "react";

const ARCHIVE_TZ = "Asia/Shanghai";
const READ_STORAGE_KEY = "ai_news_read_article_ids_v1";

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
  const [error, setError] = useState("");
  const [readSet, setReadSet] = useState<Set<string>>(new Set());
  const [days, setDays] = useState(30);
  const [limitPerDay, setLimitPerDay] = useState(10);
  const [articleLimitPerDay, setArticleLimitPerDay] = useState(0);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setDays(Math.max(1, Math.min(180, Number.parseInt(params.get("days") || "30", 10) || 30)));
    setLimitPerDay(
      Math.max(1, Math.min(50, Number.parseInt(params.get("limit_per_day") || "10", 10) || 10)),
    );
    setArticleLimitPerDay(
      Math.max(0, Math.min(5000, Number.parseInt(params.get("article_limit_per_day") || "0", 10) || 0)),
    );
    setReadSet(loadReadSet());
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadArchiveArticles(): Promise<void> {
      setLoading(true);
      setError("");
      try {
        const response = await fetch(
          `/api/archive_articles?days=${days}&limit_per_day=${limitPerDay}&article_limit_per_day=${articleLimitPerDay}`,
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
          setGroups(nextGroups);
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

  const todayItems = todayGroup?.items || [];
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

          <div className="article-headline-row">
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

          {item.summary ? <p className="article-dek">{item.summary}</p> : null}
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
      </header>

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
    </main>
  );
}
