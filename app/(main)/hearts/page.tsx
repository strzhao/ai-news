"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { SummaryDrawer } from "@/app/components/summary-drawer";
import { fetchAuthUser } from "@/lib/client/auth";
import { toggleHeart as toggleHeartApi } from "@/lib/client/hearts";
import type { AuthUser } from "@/lib/client/types";
import { pollTaskStatus, submitExtraction } from "@/lib/client/url-analysis";
import { saveUserPick, updatePickFields } from "@/lib/client/user-picks";

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

type PendingStatus = "extracting" | "done" | "failed" | "rate-limited";

interface PendingArticle {
  article_id: string;
  url: string;
  original_url: string;
  source_host: string;
  title: string;
  summary: string;
  image_url: string;
  ai_summary: string;
  _status: PendingStatus;
}

const PAGE_SIZE = 20;

const ENRICH_STEPS = [
  "正在阅读文章...",
  "正在提取内容...",
  "AI 正在总结...",
  "快好了...",
];

async function generateArticleId(url: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(url);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hex = hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
  return `pick-${hex.slice(0, 12)}`;
}

export default function HeartsPage(): React.ReactNode {
  return (
    <Suspense
      fallback={
        <div className="page-header">
          <p className="empty-note">加载中...</p>
        </div>
      }
    >
      <HeartsContent />
    </Suspense>
  );
}

function PendingCard({ item }: { item: PendingArticle }): React.ReactNode {
  const [stepIndex, setStepIndex] = useState(0);

  useEffect(() => {
    if (item._status !== "extracting") return;
    const timer = setInterval(() => {
      setStepIndex((i) => (i + 1) % ENRICH_STEPS.length);
    }, 3000);
    return () => clearInterval(timer);
  }, [item._status]);

  const cardClass = [
    "article-row numbered-article article-card-enter",
    item._status === "extracting" ? "article-pending" : "",
    item._status === "done" ? "article-enrich-done" : "",
    item._status === "failed" ? "article-enrich-failed" : "",
    item._status === "rate-limited" ? "article-enrich-failed" : "",
  ]
    .filter(Boolean)
    .join(" ");

  const displayUrl = item.original_url || item.url;
  const displayTitle = item.title || item.url;

  return (
    <article className={cardClass}>
      <div className="article-copy">
        <div className="article-meta">
          <span>{item.source_host || "正在识别来源..."}</span>
        </div>
        <h3 className="article-headline">
          <a href={displayUrl} target="_blank" rel="noreferrer noopener">
            {displayTitle}
          </a>
        </h3>

        {item._status === "extracting" ? (
          <>
            <div className="article-skeleton">
              <div className="article-skeleton-line" />
              <div className="article-skeleton-line short" />
            </div>
            <p className="article-pending-step">{ENRICH_STEPS[stepIndex]}</p>
          </>
        ) : null}

        {item._status === "done" && item.summary ? (
          <p className="article-dek">{item.summary}</p>
        ) : null}

        {item._status === "failed" ? (
          <span className="enrich-saved-tag">链接已保存</span>
        ) : null}

        {item._status === "rate-limited" ? (
          <p className="article-dek" style={{ color: "var(--muted)" }}>
            操作太频繁，请稍后再试
          </p>
        ) : null}
      </div>
    </article>
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

  const [pendingItems, setPendingItems] = useState<PendingArticle[]>([]);

  const [urlInput, setUrlInput] = useState("");
  const [inputHint, setInputHint] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [summaryArticle, setSummaryArticle] = useState<HeartedArticle | null>(
    null,
  );
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
          setItems((prev) =>
            page === 0 ? data.items : [...prev, ...data.items],
          );
          setTotal(data.total);
        }
      } catch (err) {
        if (!cancelled)
          setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [authUser, page]);

  function handleOpenSummary(item: HeartedArticle): void {
    setSummaryArticle(item);
    const url = new URL(window.location.href);
    url.searchParams.set("summary", item.article_id);
    window.history.pushState(null, "", url.toString());
  }

  // Auto-open summary from URL parameter
  useEffect(() => {
    if (loading || summaryAutoOpenedRef.current) return;
    const params = new URLSearchParams(window.location.search);
    const summaryId = params.get("summary");
    if (!summaryId) return;
    const found = items.find((item) => item.article_id === summaryId);
    if (found) {
      summaryAutoOpenedRef.current = true;
      setSummaryArticle(found);
    } else {
      summaryAutoOpenedRef.current = true;
      window.location.replace(`/summary/${encodeURIComponent(summaryId)}`);
    }
  }, [loading, items]);

  async function handleUnheart(item: HeartedArticle): Promise<void> {
    if (!window.confirm(`确定取消收藏「${item.title || "无标题"}」吗？`))
      return;
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

  function showHint(msg: string): void {
    setInputHint(msg);
    setTimeout(() => setInputHint(""), 2000);
  }

  async function enrichArticle(articleId: string, url: string): Promise<void> {
    try {
      const result = await submitExtraction(url, true);

      if (!result.ok) {
        // Check for 429-like rate limiting
        if (
          result.error?.includes("429") ||
          result.error?.includes("频繁") ||
          result.error?.includes("rate")
        ) {
          setPendingItems((prev) =>
            prev.map((p) =>
              p.article_id === articleId
                ? { ...p, _status: "rate-limited" }
                : p,
            ),
          );
          return;
        }
        setPendingItems((prev) =>
          prev.map((p) =>
            p.article_id === articleId ? { ...p, _status: "failed" } : p,
          ),
        );
        return;
      }

      if (!result.task) {
        setPendingItems((prev) =>
          prev.map((p) =>
            p.article_id === articleId ? { ...p, _status: "failed" } : p,
          ),
        );
        return;
      }

      const taskId = result.task.task_id;
      let task = result.task;
      let consecutiveFailures = 0;

      for (let i = 0; i < 120; i++) {
        if (task.status === "completed") break;
        if (task.status === "failed") {
          setPendingItems((prev) =>
            prev.map((p) =>
              p.article_id === articleId ? { ...p, _status: "failed" } : p,
            ),
          );
          return;
        }
        await new Promise((r) => setTimeout(r, 5000));
        const poll = await pollTaskStatus(taskId);
        if (poll.ok && poll.task) {
          task = poll.task;
          consecutiveFailures = 0;
        } else {
          consecutiveFailures++;
          if (consecutiveFailures >= 5) {
            setPendingItems((prev) =>
              prev.map((p) =>
                p.article_id === articleId ? { ...p, _status: "failed" } : p,
              ),
            );
            return;
          }
        }
      }

      if (task.status !== "completed") {
        setPendingItems((prev) =>
          prev.map((p) =>
            p.article_id === articleId ? { ...p, _status: "failed" } : p,
          ),
        );
        return;
      }

      // Build full fields
      const thumbResource = task.resources?.find(
        (r) => r.type === "thumbnail" || r.type === "image",
      );
      let sourceHost = "";
      try {
        sourceHost = new URL(task.url).hostname;
      } catch {
        /* ignore */
      }

      const fullFields = {
        title: task.metadata?.title || task.url,
        summary: task.metadata?.description || "",
        image_url: thumbResource?.url || "",
        source_host: sourceHost,
        url: task.url,
        original_url: task.url,
        ai_summary: task.ai_summary || "",
      };

      // Persist to Redis
      await updatePickFields(articleId, fullFields);

      // Update pending card with full data + done status
      setPendingItems((prev) =>
        prev.map((p) =>
          p.article_id === articleId
            ? {
                ...p,
                ...fullFields,
                _status: "done",
              }
            : p,
        ),
      );

      // After 2s, move from pendingItems into items
      setTimeout(() => {
        setPendingItems((prev) => {
          const found = prev.find((p) => p.article_id === articleId);
          if (found) {
            const newItem: HeartedArticle = {
              article_id: found.article_id,
              hearted_at: Date.now(),
              title: found.title,
              url: found.url,
              original_url: found.original_url,
              source_host: found.source_host,
              image_url: found.image_url,
              summary: found.summary,
              ai_summary: found.ai_summary,
            };
            setItems((prevItems) => {
              // Avoid duplicates
              const exists = prevItems.some(
                (it) => it.article_id === articleId,
              );
              if (exists) return prevItems;
              return [newItem, ...prevItems];
            });
            setTotal((t) => t + 1);
          }
          return prev.filter((p) => p.article_id !== articleId);
        });
      }, 2000);
    } catch {
      setPendingItems((prev) =>
        prev.map((p) =>
          p.article_id === articleId ? { ...p, _status: "failed" } : p,
        ),
      );
    }
  }

  async function handleSubmitUrl(
    e: React.FormEvent<HTMLFormElement>,
  ): Promise<void> {
    e.preventDefault();
    const trimmed = urlInput.trim();
    if (!trimmed) return;

    // Validate URL format
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(trimmed);
    } catch {
      showHint("请输入有效的 URL");
      return;
    }

    // Check for duplicates
    const isDuplicate = [
      ...items.map((i) => i.original_url || i.url),
      ...pendingItems.map((p) => p.original_url || p.url),
    ].some((u) => u === trimmed);

    if (isDuplicate) {
      showHint("已收藏过这篇文章");
      return;
    }

    setIsSubmitting(true);
    const articleId = await generateArticleId(trimmed);
    const sourceHost = parsedUrl.hostname;

    const minimalPayload = {
      article_id: articleId,
      title: trimmed,
      url: trimmed,
      original_url: trimmed,
      source_host: sourceHost,
      image_url: "",
      summary: "",
      ai_summary: "",
    };

    // Save minimal data to Redis immediately
    const saveResult = await saveUserPick(minimalPayload);
    if (!saveResult.ok) {
      showHint("保存失败，请重试");
      setIsSubmitting(false);
      return;
    }

    // Insert pending card at top
    const pendingCard: PendingArticle = {
      ...minimalPayload,
      _status: "extracting",
    };
    setPendingItems((prev) => [pendingCard, ...prev]);

    // Clear input
    setUrlInput("");
    setIsSubmitting(false);

    // Start background enrichment (non-blocking)
    void enrichArticle(articleId, trimmed);
  }

  if (!authChecked) {
    return (
      <div className="page-header">
        <p className="empty-note">加载中...</p>
      </div>
    );
  }

  if (!authUser) {
    const summaryId = new URLSearchParams(window.location.search).get(
      "summary",
    );
    if (summaryId) {
      window.location.replace(`/summary/${encodeURIComponent(summaryId)}`);
      return (
        <div className="page-header">
          <p className="empty-note">跳转中...</p>
        </div>
      );
    }
    return (
      <div className="page-header">
        <h1 className="page-title">我的收藏</h1>
        <p className="empty-note">请先登录后查看收藏。</p>
        <div style={{ textAlign: "center", marginTop: 20 }}>
          <a href="/api/auth/login" className="article-cta">
            登录
          </a>
        </div>
      </div>
    );
  }

  // IDs already shown in pendingItems, filter from items list
  const pendingIds = new Set(pendingItems.map((p) => p.article_id));
  const filteredItems = items.filter((i) => !pendingIds.has(i.article_id));

  return (
    <>
      <div className="page-header">
        <h1 className="page-title">我的收藏</h1>
        <p className="newsletter-subtitle">{total} 篇收藏文章</p>

        <form
          className="hearts-inline-form"
          onSubmit={(e) => {
            void handleSubmitUrl(e);
          }}
        >
          <input
            type="url"
            className="hearts-url-input"
            placeholder="粘贴文章链接，立即收录..."
            value={urlInput}
            onChange={(e) => setUrlInput(e.target.value)}
            disabled={isSubmitting}
          />
          <button
            type="submit"
            className="hearts-submit-btn"
            disabled={isSubmitting || !urlInput.trim()}
          >
            {isSubmitting ? "保存中..." : "收录"}
          </button>
        </form>
        {inputHint ? <p className="hearts-input-hint">{inputHint}</p> : null}
      </div>

      {error ? <div className="error-banner">{error}</div> : null}

      <section className="content-block">
        <div className="editorial-list">
          {/* Pending cards first */}
          {pendingItems.map((item) => (
            <PendingCard key={item.article_id} item={item} />
          ))}

          {filteredItems.length === 0 &&
          pendingItems.length === 0 &&
          !loading ? (
            <p className="empty-note">还没有收藏文章，去首页看看吧。</p>
          ) : (
            filteredItems.map((item) => {
              const articleUrl = item.original_url || item.url;
              return (
                <article
                  key={item.article_id}
                  className="article-row numbered-article"
                >
                  <div className="article-copy">
                    <div className="article-meta">
                      <span>{item.source_host || "未知来源"}</span>
                      <span>收藏于 {formatHeartedTime(item.hearted_at)}</span>
                    </div>
                    <h3 className="article-headline">
                      <a
                        href={articleUrl}
                        target="_blank"
                        rel="noreferrer noopener"
                      >
                        {item.title || "无标题"}
                      </a>
                    </h3>
                    {item.summary ? (
                      <p className="article-dek">{item.summary}</p>
                    ) : null}
                  </div>
                  <div className="article-right-col">
                    <div className="article-actions">
                      <button
                        type="button"
                        className="heart-btn is-hearted"
                        onClick={() => {
                          void handleUnheart(item);
                        }}
                        aria-label="取消收藏"
                      >
                        ♥
                      </button>
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
            })
          )}
        </div>

        {filteredItems.length < total ? (
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
        article={
          summaryArticle
            ? {
                article_id: summaryArticle.article_id,
                title: summaryArticle.title,
                url: summaryArticle.url,
                original_url: summaryArticle.original_url,
                source_host: summaryArticle.source_host,
                metaLabel: `收藏于 ${formatHeartedTime(summaryArticle.hearted_at)}`,
              }
            : null
        }
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
              item.article_id === articleId
                ? { ...item, ai_summary: newSummary }
                : item,
            ),
          );
        }}
      />
    </>
  );
}
