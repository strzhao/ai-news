"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { fetchAuthUser } from "@/lib/client/auth";
import { toggleHeart as toggleHeartApi } from "@/lib/client/hearts";
import type { AuthUser } from "@/lib/client/types";
import { SummaryDrawer } from "@/app/components/summary-drawer";

interface HeartedArticle {
  article_id: string;
  hearted_at: number;
  title: string;
  url: string;
  original_url: string;
  source_host: string;
  image_url: string;
  summary: string;
  ai_summary?: string;
}

const PAGE_SIZE = 20;

export default function HeartsPage(): React.ReactNode {
  return (
    <Suspense fallback={<div className="page-header"><p className="empty-note">加载中...</p></div>}>
      <HeartsContent />
    </Suspense>
  );
}

function HeartsContent(): React.ReactNode {
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [items, setItems] = useState<HeartedArticle[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [summaryArticle, setSummaryArticle] = useState<HeartedArticle | null>(null);
  const summaryAutoOpenedRef = useRef(false);

  useEffect(() => {
    void (async () => {
      const { user } = await fetchAuthUser();
      setAuthUser(user);
      setAuthChecked(true);
    })();
  }, []);

  useEffect(() => {
    if (!authUser) return;
    let cancelled = false;
    async function load(): Promise<void> {
      setLoading(true);
      setError("");
      try {
        const res = await fetch(
          `/api/v1/hearts?page=${page}&size=${PAGE_SIZE}`,
          { cache: "no-store", credentials: "include" },
        );
        const data = await res.json();
        if (!res.ok || !data.ok) throw new Error("加载收藏失败");
        if (!cancelled) {
          setItems((prev) => page === 0 ? data.items : [...prev, ...data.items]);
          setTotal(data.total);
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => { cancelled = true; };
  }, [authUser, page]);

  function handleOpenSummary(item: HeartedArticle): void {
    setSummaryArticle(item);
    const url = new URL(window.location.href);
    url.searchParams.set("summary", item.article_id);
    window.history.pushState(null, "", url.toString());
  }

  // Auto-open summary from URL parameter
  useEffect(() => {
    if (loading || items.length === 0 || summaryAutoOpenedRef.current) return;
    const params = new URLSearchParams(window.location.search);
    const summaryId = params.get("summary");
    if (!summaryId) return;
    const found = items.find((item) => item.article_id === summaryId);
    if (found) {
      summaryAutoOpenedRef.current = true;
      setSummaryArticle(found);
    }
  }, [loading, items]);

  async function handleUnheart(item: HeartedArticle): Promise<void> {
    if (!window.confirm(`确定取消收藏「${item.title || "无标题"}」吗？`)) return;
    const prev = [...items];
    setItems((list) => list.filter((i) => i.article_id !== item.article_id));
    setTotal((t) => Math.max(0, t - 1));
    try {
      await toggleHeartApi(item);
    } catch {
      setItems(prev);
      setTotal((t) => t + 1);
    }
  }

  function formatHeartedTime(ts: number): string {
    if (!ts) return "";
    return new Intl.DateTimeFormat("zh-CN", {
      timeZone: "Asia/Shanghai",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(new Date(ts));
  }

  if (!authChecked) {
    return (
      <div className="page-header">
        <p className="empty-note">加载中...</p>
      </div>
    );
  }

  if (!authUser) {
    return (
      <div className="page-header">
        <h1 className="page-title">我的收藏</h1>
        <p className="empty-note">请先登录后查看收藏。</p>
        <div style={{ textAlign: "center", marginTop: 20 }}>
          <a href="/api/auth/login" className="article-cta">登录</a>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="page-header">
        <h1 className="page-title">我的收藏</h1>
        <p className="newsletter-subtitle">{total} 篇收藏文章</p>
      </div>

      {error ? <div className="error-banner">{error}</div> : null}

      <section className="content-block">
        <div className="editorial-list">
          {items.length === 0 && !loading ? (
            <p className="empty-note">还没有收藏文章，去首页看看吧。</p>
          ) : (
            items.map((item) => {
              const articleUrl = item.original_url || item.url;
              return (
                <article key={item.article_id} className="article-row numbered-article">
                  <div className="article-copy">
                    <div className="article-meta">
                      <span>{item.source_host || "未知来源"}</span>
                      <span>收藏于 {formatHeartedTime(item.hearted_at)}</span>
                    </div>
                    <h3 className="article-headline">
                      <a href={articleUrl} target="_blank" rel="noreferrer noopener">
                        {item.title || "无标题"}
                      </a>
                    </h3>
                    {item.summary ? <p className="article-dek">{item.summary}</p> : null}
                  </div>
                  <div className="article-right-col">
                    <div className="article-actions">
                      <button
                        type="button"
                        className="heart-btn is-hearted"
                        onClick={() => { void handleUnheart(item); }}
                        aria-label="取消收藏"
                      >
                        ♥
                      </button>
                      <button type="button" className="article-cta" onClick={() => handleOpenSummary(item)}>AI 总结</button>
                    </div>
                  </div>
                </article>
              );
            })
          )}
        </div>

        {items.length < total ? (
          <div className="load-more-wrap">
            <button
              type="button"
              className="load-more-btn"
              onClick={() => setPage((p) => p + 1)}
              disabled={loading}
            >
              {loading ? "加载中..." : "加载更多"}
            </button>
          </div>
        ) : null}
      </section>

      <SummaryDrawer
        article={summaryArticle ? {
          article_id: summaryArticle.article_id,
          title: summaryArticle.title,
          url: summaryArticle.url,
          original_url: summaryArticle.original_url,
          source_host: summaryArticle.source_host,
          metaLabel: `收藏于 ${formatHeartedTime(summaryArticle.hearted_at)}`,
        } : null}
        open={summaryArticle !== null}
        onClose={() => {
          setSummaryArticle(null);
          const url = new URL(window.location.href);
          if (url.searchParams.has("summary")) {
            url.searchParams.delete("summary");
            window.history.replaceState(null, "", url.toString());
          }
        }}
        preloadedSummary={summaryArticle?.ai_summary || undefined}
        onSummaryRegenerated={(articleId, newSummary) => {
          setItems((prev) =>
            prev.map((item) =>
              item.article_id === articleId ? { ...item, ai_summary: newSummary } : item,
            ),
          );
        }}
      />
    </>
  );
}
