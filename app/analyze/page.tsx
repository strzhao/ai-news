"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  AUTH_STATE_STORAGE_KEY,
  buildAuthorizeUrlForCurrentOrigin,
  generateAuthState,
} from "@/lib/auth-config";
import { fetchAuthUser } from "@/lib/client/auth";
import type { AuthUser, ExtractedResource, ExtractionMetadata } from "@/lib/client/types";
import { submitExtraction, pollTaskStatus, type ExtractionTaskResponse } from "@/lib/client/url-analysis";
import NavTabs from "@/app/components/nav-tabs";

const POLL_INTERVAL_MS = 5_000;
const MAX_POLL_ATTEMPTS = 120; // 10 minutes max

const PLATFORM_LABELS: Record<string, string> = {
  youtube: "YouTube",
  bilibili: "Bilibili",
  twitter: "Twitter / X",
  xiaohongshu: "小红书",
  instagram: "Instagram",
  webpage: "网页",
  unknown: "未知",
};

const RESOURCE_TYPE_LABELS: Record<string, string> = {
  video: "视频",
  audio: "音频",
  subtitle: "字幕",
  thumbnail: "缩略图",
  image: "图片",
  text: "文本",
  metadata: "元数据",
};

function formatDuration(seconds: number | undefined): string {
  if (!seconds) return "";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function formatFileSize(bytes: number): string {
  if (!bytes || bytes <= 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function expiryText(expiresAt: string | undefined): string {
  if (!expiresAt) return "";
  const remaining = new Date(expiresAt).getTime() - Date.now();
  if (remaining <= 0) return "已过期";
  const hours = Math.ceil(remaining / (3600 * 1000));
  if (hours <= 1) return "1 小时内过期";
  return `${hours} 小时内过期`;
}

export default function AnalyzePage(): React.ReactNode {
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [url, setUrl] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [polling, setPolling] = useState(false);
  const [task, setTask] = useState<ExtractionTaskResponse | null>(null);
  const [error, setError] = useState("");
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollCountRef = useRef(0);

  useEffect(() => {
    void (async () => {
      const { user } = await fetchAuthUser();
      setAuthUser(user);
      setAuthLoading(false);
    })();
  }, []);

  const stopPolling = useCallback(() => {
    if (pollTimerRef.current) {
      clearTimeout(pollTimerRef.current);
      pollTimerRef.current = null;
    }
    setPolling(false);
    pollCountRef.current = 0;
  }, []);

  const startPolling = useCallback(
    (taskId: string) => {
      setPolling(true);
      pollCountRef.current = 0;

      async function poll(): Promise<void> {
        pollCountRef.current += 1;
        if (pollCountRef.current > MAX_POLL_ATTEMPTS) {
          setError("提取超时，请稍后刷新页面查看结果");
          setPolling(false);
          return;
        }

        try {
          const result = await pollTaskStatus(taskId);
          if (result.ok && result.task) {
            setTask(result.task);
            if (result.task.status === "completed" || result.task.status === "failed") {
              setPolling(false);
              if (result.task.status === "failed") {
                setError(result.task.error_message || "提取失败");
              }
              return;
            }
          }
        } catch {
          // Retry on network errors
        }

        pollTimerRef.current = setTimeout(poll, POLL_INTERVAL_MS);
      }

      pollTimerRef.current = setTimeout(poll, POLL_INTERVAL_MS);
    },
    [],
  );

  useEffect(() => {
    return () => {
      if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
    };
  }, []);

  async function handleSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    const trimmed = url.trim();
    if (!trimmed) return;

    setError("");
    setTask(null);
    setSubmitting(true);
    stopPolling();

    try {
      const result = await submitExtraction(trimmed);
      if (!result.ok) {
        setError(result.error || "提交失败");
        return;
      }

      if (result.task) {
        setTask(result.task);
        if (result.task.status === "pending" || result.task.status === "processing") {
          startPolling(result.task.task_id);
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  function startUnifiedLogin(): void {
    const state = generateAuthState();
    try {
      window.sessionStorage.setItem(AUTH_STATE_STORAGE_KEY, state);
    } catch {
      // Ignore
    }
    window.location.assign(buildAuthorizeUrlForCurrentOrigin(state));
  }

  const isLoading = submitting || polling;
  const showResults = task && task.status === "completed";
  const isPending = task && (task.status === "pending" || task.status === "processing");

  return (
    <main className="newsroom-shell">
      <header className="newsroom-hero">
        <div className="hero-topbar">
          <p className="eyebrow">AI News Daily Edition</p>
          <div className="hero-auth-corner">
            <div className="hero-auth-row">
              {authUser ? (
                <Link href="/settings" className="auth-user-chip">{authUser.email}</Link>
              ) : !authLoading ? (
                <button type="button" className="auth-login-btn" onClick={startUnifiedLogin}>
                  统一账号登录
                </button>
              ) : null}
            </div>
          </div>
        </div>
        <NavTabs />
        <h1>URL 资源提取</h1>
        <p className="hero-meta">
          支持 YouTube / Bilibili / Twitter / 小红书 / Instagram / 网页
        </p>
      </header>

      {!authUser && !authLoading ? (
        <section className="content-block">
          <div className="analyze-login-prompt">
            <p>请先登录后使用 URL 分析功能。</p>
            <button type="button" className="flomo-btn" onClick={startUnifiedLogin}>
              统一账号登录
            </button>
          </div>
        </section>
      ) : null}

      {authUser ? (
        <section className="content-block">
          <form className="analyze-form" onSubmit={handleSubmit}>
            <div className="analyze-input-row">
              <input
                type="url"
                className="analyze-input"
                placeholder="输入 URL，例如 https://youtube.com/watch?v=..."
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                disabled={isLoading}
                required
              />
              <button type="submit" className="flomo-btn analyze-submit" disabled={isLoading || !url.trim()}>
                {isLoading ? "提取中..." : "提取"}
              </button>
            </div>
          </form>

          {error ? <div className="error-banner" style={{ marginTop: 16 }}>{error}</div> : null}

          {isPending ? (
            <div className="analyze-pending">
              <div className="analyze-spinner" />
              <p className="analyze-pending-text">
                正在提取资源
                {task.platform ? ` (${PLATFORM_LABELS[task.platform] || task.platform})` : ""}
                ，通常需要 30-120 秒...
              </p>
              <p className="analyze-pending-hint">请勿关闭页面，提取完成后将自动展示结果。</p>
            </div>
          ) : null}

          {showResults ? (
            <div className="analyze-results">
              <div className="analyze-result-header">
                <div className="analyze-platform-badge">
                  {PLATFORM_LABELS[task.platform] || task.platform}
                </div>
                {task.blob_ttl_hours ? (
                  <span className="expiry-badge">
                    资源将在 {task.blob_ttl_hours} 小时后过期
                  </span>
                ) : null}
              </div>

              {task.metadata?.title ? (
                <h2 className="analyze-result-title">{task.metadata.title}</h2>
              ) : null}

              <div className="analyze-metadata">
                {task.metadata?.author ? <span>作者: {task.metadata.author}</span> : null}
                {task.metadata?.duration ? <span>时长: {formatDuration(task.metadata.duration)}</span> : null}
                {task.metadata?.published_at ? <span>发布: {task.metadata.published_at}</span> : null}
              </div>

              {task.metadata?.description ? (
                <p className="analyze-description">{task.metadata.description}</p>
              ) : null}

              {task.metadata?.tags?.length ? (
                <div className="analyze-tags">
                  {task.metadata.tags.map((tag) => (
                    <span key={tag} className="tag-chip">{tag}</span>
                  ))}
                </div>
              ) : null}

              {task.resources?.length ? (
                <div className="resource-list">
                  <h3 className="resource-list-title">提取的资源 ({task.resources.length})</h3>
                  {task.resources.map((resource, idx) => (
                    <ResourceCard key={`${resource.type}-${idx}`} resource={resource} />
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
        </section>
      ) : null}
    </main>
  );
}

function ResourceCard({ resource }: { resource: ExtractedResource }): React.ReactNode {
  const typeLabel = RESOURCE_TYPE_LABELS[resource.type] || resource.type;
  const expiry = expiryText(resource.expires_at);

  return (
    <div className="resource-card">
      <div className="resource-card-header">
        <span className={`resource-type-badge resource-type-${resource.type}`}>{typeLabel}</span>
        <span className="resource-filename">{resource.filename}</span>
        {resource.size_bytes ? <span className="resource-size">{formatFileSize(resource.size_bytes)}</span> : null}
        {resource.format ? <span className="resource-format">{resource.format}</span> : null}
        {resource.language ? <span className="resource-language">{resource.language}</span> : null}
      </div>

      {resource.type === "video" && resource.url ? (
        <video className="resource-video" controls preload="metadata" src={resource.url} />
      ) : null}

      {resource.type === "audio" && resource.url ? (
        <audio className="resource-audio" controls preload="metadata" src={resource.url} />
      ) : null}

      {resource.type === "image" && resource.url ? (
        <img className="resource-image" src={resource.url} alt={resource.filename} loading="lazy" />
      ) : null}

      <div className="resource-card-footer">
        {resource.url ? (
          <a
            className="resource-download"
            href={resource.url}
            target="_blank"
            rel="noreferrer noopener"
            download={resource.filename}
          >
            下载
          </a>
        ) : null}
        {expiry ? <span className="expiry-badge expiry-badge-small">{expiry}</span> : null}
      </div>
    </div>
  );
}
