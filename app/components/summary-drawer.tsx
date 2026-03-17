"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import { submitExtraction, pollTaskStatus } from "@/lib/client/url-analysis";
import { updatePickSummary } from "@/lib/client/user-picks";

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
  onSummaryRegenerated?: (articleId: string, newSummary: string) => void;
}

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

export function SummaryDrawer({ article, open, onClose, preloadedSummary, onSummaryRegenerated }: SummaryDrawerProps): React.ReactNode {
  const [summaryMarkdown, setSummaryMarkdown] = useState("");
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryError, setSummaryError] = useState("");
  const [regenerating, setRegenerating] = useState(false);
  const [copied, setCopied] = useState(false);
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeArticleIdRef = useRef<string | null>(null);

  const cleanupPoll = useCallback(() => {
    if (pollRef.current) {
      clearTimeout(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const fetchSummary = useCallback(async (articleId: string, pollCount = 0) => {
    if (activeArticleIdRef.current !== articleId) return;
    try {
      const response = await fetch(`/api/article_summary/${encodeURIComponent(articleId)}`, { cache: "no-store" });
      const data = await response.json();
      if (activeArticleIdRef.current !== articleId) return;

      if (!data.ok) {
        setSummaryError("暂无 AI 总结");
      } else if (data.status === "completed" && data.summary_markdown) {
        setSummaryMarkdown(data.summary_markdown);
      } else if (data.status === "no_content") {
        setSummaryError("文章内容不足，无法生成 AI 总结");
      } else if (data.status === "failed") {
        setSummaryError(data.error || "AI 总结生成失败，请稍后重试");
      } else if (pollCount < 60) {
        pollRef.current = setTimeout(() => { void fetchSummary(articleId, pollCount + 1); }, 5000);
        return;
      } else {
        setSummaryError("总结生成超时，请稍后重试");
      }
      setSummaryLoading(false);
    } catch (err) {
      if (activeArticleIdRef.current !== articleId) return;
      setSummaryError(err instanceof Error ? err.message : "网络错误");
      setSummaryLoading(false);
    }
  }, []);

  const handleRegenerate = useCallback(async () => {
    if (!article) return;
    const articleUrl = article.original_url || article.url;
    setRegenerating(true);
    setSummaryError("");
    setSummaryLoading(true);

    function finishRegen(error?: string): void {
      if (error) setSummaryError(error);
      setSummaryLoading(false);
      setRegenerating(false);
    }

    try {
      const result = await submitExtraction(articleUrl, true);
      if (!result.ok || !result.task) {
        finishRegen(result.error || "重新生成失败");
        return;
      }

      const taskId = result.task.task_id;
      let task = result.task;

      for (let i = 0; i < 60; i++) {
        if (activeArticleIdRef.current !== article.article_id) {
          setRegenerating(false);
          return;
        }
        await new Promise((r) => setTimeout(r, 5000));
        const poll = await pollTaskStatus(taskId);
        if (poll.ok && poll.task) {
          task = poll.task;
          if (task.ai_summary) {
            setSummaryMarkdown(task.ai_summary);
            setSummaryError("");
            finishRegen();
            await updatePickSummary(article.article_id, task.ai_summary);
            onSummaryRegenerated?.(article.article_id, task.ai_summary);
            return;
          }
          if (task.status === "failed") {
            finishRegen(task.error_message || "重新生成失败");
            return;
          }
        }
      }

      finishRegen("重新生成超时，请稍后重试");
    } catch (err) {
      finishRegen(err instanceof Error ? err.message : "网络错误");
    }
  }, [article, onSummaryRegenerated]);

  // Start / stop fetching when open or article changes
  useEffect(() => {
    if (open && article) {
      cleanupPoll();
      activeArticleIdRef.current = article.article_id;
      setSummaryMarkdown("");
      setSummaryError("");
      setCopied(false);
      // Use preloaded summary when available (e.g. user-picks articles not in article-db)
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
          <span>{article.metaLabel ?? (article.generated_at ? formatTime(article.generated_at) : "-")}</span>
        </div>

        {summaryLoading && !showPreloaded ? (
          <div className="analyze-pending">
            <div className="analyze-spinner" />
            <p className="analyze-pending-text">{regenerating ? "正在重新生成 AI 总结..." : "正在生成 AI 总结..."}</p>
            <p className="analyze-pending-hint">通常需要 30-60 秒，请稍候</p>
          </div>
        ) : null}

        {hasError && !suppressError ? (
          <div className="error-banner" style={{ marginTop: 20 }}>
            {summaryError}
            {!regenerating ? (
              <button type="button" className="regen-btn" onClick={() => { void handleRegenerate(); }}>
                重新生成
              </button>
            ) : null}
          </div>
        ) : null}

        {showPreloaded ? (
          <div className="summary-content">
            <ReactMarkdown
              components={{
                a: ({ children, href, ...props }) => (
                  <a href={href} target="_blank" rel="noreferrer noopener" {...props}>{children}</a>
                ),
              }}
            >
              {preloadedSummary}
            </ReactMarkdown>
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
          <button
            type="button"
            className="share-link-btn"
            onClick={() => {
              const shareUrl = `${window.location.origin}/summary/${article.article_id}`;
              void navigator.clipboard.writeText(shareUrl).then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              });
            }}
          >
            {copied ? "已复制" : "复制分享链接"}
          </button>
        </div>
      </div>
    </>
  );
}
