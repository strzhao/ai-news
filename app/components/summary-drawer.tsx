"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";

/* ── Types ── */

export interface SummaryDrawerArticle {
  article_id: string;
  title: string;
  url: string;
  original_url?: string;
  source_host: string;
  generated_at?: string;
  metaLabel?: string;
}

export interface SummaryDrawerProps {
  article: SummaryDrawerArticle | null;
  open: boolean;
  onClose: () => void;
  preloadedSummary?: string;
}

/* ── Helpers ── */

function formatTime(value: string): string {
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

/* ── Component ── */

export function SummaryDrawer({ article, open, onClose, preloadedSummary }: SummaryDrawerProps): React.ReactNode {
  const [summaryMarkdown, setSummaryMarkdown] = useState("");
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryError, setSummaryError] = useState("");
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeArticleIdRef = useRef<string | null>(null);

  const cleanupPoll = useCallback(() => {
    if (pollRef.current) {
      clearTimeout(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const fetchSummary = useCallback(async (articleId: string, pollCount = 0) => {
    // Bail out if the article changed while we were polling
    if (activeArticleIdRef.current !== articleId) return;
    try {
      const response = await fetch(`/api/article_summary/${encodeURIComponent(articleId)}`, { cache: "no-store" });
      const data = await response.json();
      if (activeArticleIdRef.current !== articleId) return;
      if (!data.ok) {
        setSummaryError("暂无 AI 总结");
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
      if (pollCount < 60) {
        pollRef.current = setTimeout(() => { void fetchSummary(articleId, pollCount + 1); }, 5000);
      } else {
        setSummaryError("总结生成超时，请稍后重试");
        setSummaryLoading(false);
      }
    } catch (err) {
      if (activeArticleIdRef.current !== articleId) return;
      setSummaryError(err instanceof Error ? err.message : "网络错误");
      setSummaryLoading(false);
    }
  }, []);

  // Start / stop fetching when open or article changes
  useEffect(() => {
    if (open && article) {
      cleanupPoll();
      activeArticleIdRef.current = article.article_id;
      setSummaryMarkdown("");
      setSummaryError("");
      // Skip API call when preloadedSummary is available (e.g. user-picks articles not in article-db)
      if (preloadedSummary) {
        setSummaryLoading(false);
      } else {
        setSummaryLoading(true);
        void fetchSummary(article.article_id);
      }
    } else {
      cleanupPoll();
      activeArticleIdRef.current = null;
      setSummaryMarkdown("");
      setSummaryLoading(false);
      setSummaryError("");
    }
    return cleanupPoll;
  }, [open, article?.article_id, cleanupPoll, fetchSummary]);

  // Escape key handler
  useEffect(() => {
    if (!open) return;
    function handleKeyDown(e: KeyboardEvent): void {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  // Cleanup poll on unmount
  useEffect(() => {
    return () => { if (pollRef.current) clearTimeout(pollRef.current); };
  }, []);

  if (!open || !article) return null;

  const articleUrl = article.original_url || article.url;
  const showPreloaded = preloadedSummary && !summaryMarkdown;
  const hasError = !!summaryError;
  const suppressError = hasError && !!preloadedSummary;

  return (
    <>
      <div className="drawer-overlay" onClick={onClose} />
      <div className="drawer-panel" role="dialog" aria-modal="true">
        <button type="button" className="drawer-close" onClick={onClose}>
          ✕
        </button>
        <h2 className="summary-drawer-title">{article.title}</h2>
        <div className="summary-drawer-meta">
          <span>{article.source_host || "未知来源"}</span>
          <span> · </span>
          <span>
            {article.metaLabel
              ? article.metaLabel
              : article.generated_at
                ? formatTime(article.generated_at)
                : "-"}
          </span>
        </div>

        {summaryLoading && !showPreloaded ? (
          <div className="analyze-pending">
            <div className="analyze-spinner" />
            <p className="analyze-pending-text">正在生成 AI 总结...</p>
            <p className="analyze-pending-hint">通常需要 30-60 秒，请稍候</p>
          </div>
        ) : null}

        {hasError && !suppressError ? (
          <div className="error-banner" style={{ marginTop: 20 }}>{summaryError}</div>
        ) : null}

        {showPreloaded ? (
          <div className="summary-content">
            <div>{preloadedSummary}</div>
          </div>
        ) : null}

        {summaryMarkdown ? (
          <div className="summary-content">
            <ReactMarkdown
              components={{
                a: ({ children, href, ...props }) => (
                  <a href={href} target="_blank" rel="noreferrer noopener" {...props}>{children}</a>
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
            href={articleUrl}
            target="_blank"
            rel="noreferrer noopener"
          >
            阅读原文
          </a>
        </div>
      </div>
    </>
  );
}
