"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { fetchAuthUser } from "@/lib/client/auth";
import type { AuthUser, ExtractedResource } from "@/lib/client/types";
import {
  submitExtraction,
  pollTaskStatus,
  fetchTaskList,
  type ExtractionTaskResponse,
} from "@/lib/client/url-analysis";

const POLL_INTERVAL_MS = 5_000;
const MAX_POLL_ATTEMPTS = 120;

const PLATFORM_LABELS: Record<string, string> = {
  youtube: "YouTube",
  bilibili: "Bilibili",
  twitter: "Twitter / X",
  xiaohongshu: "小红书",
  instagram: "Instagram",
  webpage: "网页",
  unknown: "未知",
};

const PLATFORM_ICONS: Record<string, string> = {
  youtube: "▶",
  bilibili: "📺",
  twitter: "𝕏",
  xiaohongshu: "📕",
  instagram: "📷",
  webpage: "🌐",
  unknown: "?",
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

function isTaskExpired(task: ExtractionTaskResponse): boolean {
  if (task.status !== "completed") return false;
  // Check blob_ttl_hours from completed_at
  if (task.completed_at && task.blob_ttl_hours) {
    const expiry = new Date(task.completed_at).getTime() + task.blob_ttl_hours * 3600 * 1000;
    if (Date.now() > expiry) return true;
  }
  // Check if all resources have expired
  if (task.resources?.length > 0) {
    const allExpired = task.resources.every(
      (r) => r.expires_at && new Date(r.expires_at).getTime() < Date.now(),
    );
    if (allExpired) return true;
  }
  return false;
}

function isResourceExpired(resource: ExtractedResource): boolean {
  return !!resource.expires_at && new Date(resource.expires_at).getTime() < Date.now();
}

function formatRelativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "刚刚";
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} 天前`;
  return new Date(dateStr).toLocaleDateString("zh-CN");
}

function getThumbnailUrl(task: ExtractionTaskResponse): string | null {
  if (!task.resources) return null;
  const thumb = task.resources.find((r) => r.type === "thumbnail" || r.type === "image");
  return thumb?.url || null;
}

export default function AnalyzePage(): React.ReactNode {
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [url, setUrl] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  // Task list state
  const [tasks, setTasks] = useState<ExtractionTaskResponse[]>([]);
  const [tasksLoading, setTasksLoading] = useState(false);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [archivedCollapsed, setArchivedCollapsed] = useState(true);

  // Polling: support multiple concurrent polls
  const pollTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const pollCountsRef = useRef<Map<string, number>>(new Map());

  // Auth check + load task list
  useEffect(() => {
    void (async () => {
      const { user } = await fetchAuthUser();
      setAuthUser(user);
      setAuthLoading(false);

      if (user) {
        setTasksLoading(true);
        try {
          const result = await fetchTaskList();
          if (result.ok) {
            setTasks(result.tasks);
            // Resume polling for pending/processing tasks
            for (const t of result.tasks) {
              if (t.status === "pending" || t.status === "processing") {
                startPolling(t.task_id);
              }
            }
          }
        } finally {
          setTasksLoading(false);
        }
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Cleanup all poll timers on unmount
  useEffect(() => {
    return () => {
      for (const timer of pollTimersRef.current.values()) {
        clearTimeout(timer);
      }
    };
  }, []);

  const stopPolling = useCallback((taskId: string) => {
    const timer = pollTimersRef.current.get(taskId);
    if (timer) {
      clearTimeout(timer);
      pollTimersRef.current.delete(taskId);
    }
    pollCountsRef.current.delete(taskId);
  }, []);

  const startPolling = useCallback(
    (taskId: string) => {
      pollCountsRef.current.set(taskId, 0);

      async function poll(): Promise<void> {
        const count = (pollCountsRef.current.get(taskId) || 0) + 1;
        pollCountsRef.current.set(taskId, count);

        if (count > MAX_POLL_ATTEMPTS) {
          pollTimersRef.current.delete(taskId);
          pollCountsRef.current.delete(taskId);
          return;
        }

        try {
          const result = await pollTaskStatus(taskId);
          if (result.ok && result.task) {
            setTasks((prev) =>
              prev.map((t) => (t.task_id === taskId ? result.task! : t)),
            );
            if (result.task.status === "completed" || result.task.status === "failed") {
              pollTimersRef.current.delete(taskId);
              pollCountsRef.current.delete(taskId);
              return;
            }
          }
        } catch {
          // Retry on network errors
        }

        pollTimersRef.current.set(taskId, setTimeout(poll, POLL_INTERVAL_MS));
      }

      pollTimersRef.current.set(taskId, setTimeout(poll, POLL_INTERVAL_MS));
    },
    [],
  );

  async function handleSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    const trimmed = url.trim();
    if (!trimmed) return;

    setError("");
    setSubmitting(true);

    try {
      const result = await submitExtraction(trimmed);
      if (!result.ok) {
        setError(result.error || "提交失败");
        return;
      }

      if (result.task) {
        // Add to list head
        setTasks((prev) => [result.task!, ...prev.filter((t) => t.task_id !== result.task!.task_id)]);
        // Open drawer for the new task
        setSelectedTaskId(result.task.task_id);
        setDrawerOpen(true);
        setUrl("");

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

  function openDrawer(taskId: string): void {
    setSelectedTaskId(taskId);
    setDrawerOpen(true);
  }

  function closeDrawer(): void {
    setDrawerOpen(false);
  }

  function startUnifiedLogin(): void {
    window.location.assign("/api/auth/login");
  }

  // Handle ESC to close drawer
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent): void {
      if (e.key === "Escape" && drawerOpen) {
        closeDrawer();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [drawerOpen]);

  // Derived state
  const activeTasks = useMemo(
    () => tasks.filter((t) => !isTaskExpired(t)).sort((a, b) => b.created_at.localeCompare(a.created_at)),
    [tasks],
  );

  const archivedTasks = useMemo(
    () => tasks.filter((t) => isTaskExpired(t)).sort((a, b) => b.created_at.localeCompare(a.created_at)),
    [tasks],
  );

  const selectedTask = useMemo(
    () => tasks.find((t) => t.task_id === selectedTaskId) || null,
    [tasks, selectedTaskId],
  );

  const isPolling = pollTimersRef.current.size > 0;

  return (
    <>
      <div className="page-header">
        <h1 className="page-title">URL 资源提取</h1>
        <p className="page-meta">
          支持 YouTube / Bilibili / Twitter / 小红书 / Instagram / 网页
        </p>
      </div>

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
          {/* URL Input Form */}
          <form className="analyze-form" onSubmit={handleSubmit}>
            <div className="analyze-input-row">
              <input
                type="url"
                className="analyze-input"
                placeholder="输入 URL，例如 https://youtube.com/watch?v=..."
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                disabled={submitting}
                required
              />
              <button type="submit" className="flomo-btn analyze-submit" disabled={submitting || !url.trim()}>
                {submitting ? "提取中..." : "提取"}
              </button>
            </div>
          </form>

          {error ? <div className="error-banner" style={{ marginTop: 16 }}>{error}</div> : null}

          {/* Active Tasks */}
          {tasksLoading ? (
            <div className="analyze-pending" style={{ marginTop: 20 }}>
              <div className="analyze-spinner" />
              <p className="analyze-pending-text">加载历史任务...</p>
            </div>
          ) : (
            <>
              {activeTasks.length > 0 ? (
                <div className="task-list">
                  <div className="task-list-header">
                    任务列表
                    <span className="task-list-count">({activeTasks.length})</span>
                  </div>
                  {activeTasks.map((t) => (
                    <TaskCard
                      key={t.task_id}
                      task={t}
                      isActive={t.task_id === selectedTaskId && drawerOpen}
                      onClick={() => openDrawer(t.task_id)}
                    />
                  ))}
                </div>
              ) : !tasksLoading && tasks.length === 0 ? (
                <p style={{ marginTop: 24, color: "var(--muted)", fontSize: 14, textAlign: "center" }}>
                  暂无提取任务，输入 URL 开始提取
                </p>
              ) : null}

              {/* Archived Tasks */}
              {archivedTasks.length > 0 ? (
                <div className="archive-section">
                  <button
                    type="button"
                    className={`archive-toggle${archivedCollapsed ? "" : " is-expanded"}`}
                    onClick={() => setArchivedCollapsed(!archivedCollapsed)}
                  >
                    已归档 ({archivedTasks.length})
                  </button>
                  {!archivedCollapsed ? (
                    <div className="archive-list">
                      {archivedTasks.map((t) => (
                        <ArchivedTaskCard
                          key={t.task_id}
                          task={t}
                          onClick={() => openDrawer(t.task_id)}
                        />
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </>
          )}
        </section>
      ) : null}

      {/* Drawer */}
      {drawerOpen && selectedTask ? (
        <TaskDrawer task={selectedTask} expired={isTaskExpired(selectedTask)} onClose={closeDrawer} />
      ) : null}
    </>
  );
}

/* ── Task Card ── */

function TaskCard({
  task,
  isActive,
  onClick,
}: {
  task: ExtractionTaskResponse;
  isActive: boolean;
  onClick: () => void;
}): React.ReactNode {
  const thumb = getThumbnailUrl(task);
  const title = task.metadata?.title || task.url;
  const platform = PLATFORM_LABELS[task.platform] || task.platform;
  const icon = PLATFORM_ICONS[task.platform] || "?";

  return (
    <div className={`task-card${isActive ? " is-active" : ""}`} onClick={onClick}>
      {thumb ? (
        <img className="task-card-thumb" src={thumb} alt="" loading="lazy" />
      ) : (
        <div className="task-card-thumb-placeholder">{icon}</div>
      )}
      <div className="task-card-body">
        <div className="task-card-title">{title}</div>
        <div className="task-card-meta">
          <span>{platform}</span>
          <span>{formatRelativeTime(task.created_at)}</span>
        </div>
      </div>
      <div className={`task-card-status status-${task.status}`} title={task.status} />
    </div>
  );
}

/* ── Archived Task Card ── */

function ArchivedTaskCard({
  task,
  onClick,
}: {
  task: ExtractionTaskResponse;
  onClick: () => void;
}): React.ReactNode {
  const platform = PLATFORM_LABELS[task.platform] || task.platform;

  return (
    <div className="archived-card" onClick={onClick}>
      <span className="analyze-platform-badge" style={{ fontSize: 11, padding: "2px 6px" }}>
        {platform}
      </span>
      <span className="archived-card-title">
        {task.metadata?.title || task.url}
      </span>
      <span className="archived-card-url" title={task.url}>{task.url}</span>
      <span className="archived-card-meta">{formatRelativeTime(task.created_at)}</span>
    </div>
  );
}

/* ── Task Drawer ── */

function TaskDrawer({
  task,
  expired,
  onClose,
}: {
  task: ExtractionTaskResponse;
  expired: boolean;
  onClose: () => void;
}): React.ReactNode {
  const isPending = task.status === "pending" || task.status === "processing";

  return (
    <>
      <div className="drawer-overlay" onClick={onClose} />
      <div className="drawer-panel" role="dialog" aria-modal="true">
        <button type="button" className="drawer-close" onClick={onClose} aria-label="关闭">
          ✕
        </button>

        {isPending ? (
          <div className="analyze-pending" style={{ marginTop: 40 }}>
            <div className="analyze-spinner" />
            <p className="analyze-pending-text">
              正在提取资源
              {task.platform ? ` (${PLATFORM_LABELS[task.platform] || task.platform})` : ""}
              ，通常需要 30-120 秒...
            </p>
            <p className="analyze-pending-hint">提取完成后将自动展示结果。</p>
          </div>
        ) : null}

        {task.status === "failed" ? (
          <div className="error-banner" style={{ marginTop: 40 }}>
            {task.error_message || "提取失败"}
          </div>
        ) : null}

        {task.status === "completed" ? (
          <div className="analyze-results" style={{ marginTop: 16 }}>
            {expired ? (
              <div className="drawer-expired-notice">
                资源已过期，仅显示元数据信息。媒体文件已不可访问。
              </div>
            ) : null}

            <div className="analyze-result-header">
              <div className="analyze-platform-badge">
                {PLATFORM_LABELS[task.platform] || task.platform}
              </div>
              {!expired && task.blob_ttl_hours ? (
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

            <p style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}>
              原始链接：<a href={task.url} target="_blank" rel="noreferrer noopener" style={{ color: "var(--accent)" }}>{task.url}</a>
            </p>

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
                  <ResourceCard key={`${resource.type}-${idx}`} resource={resource} taskExpired={expired} />
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </>
  );
}

/* ── Resource Card ── */

function ResourceCard({
  resource,
  taskExpired,
}: {
  resource: ExtractedResource;
  taskExpired: boolean;
}): React.ReactNode {
  const typeLabel = RESOURCE_TYPE_LABELS[resource.type] || resource.type;
  const expiry = expiryText(resource.expires_at);
  const resourceIsExpired = taskExpired || isResourceExpired(resource);
  const isLargeMedia = resource.type === "video" || resource.type === "audio";

  return (
    <div className="resource-card">
      <div className="resource-card-header">
        <span className={`resource-type-badge resource-type-${resource.type}`}>{typeLabel}</span>
        <span className="resource-filename">{resource.filename}</span>
        {resource.size_bytes ? <span className="resource-size">{formatFileSize(resource.size_bytes)}</span> : null}
        {resource.format ? <span className="resource-format">{resource.format}</span> : null}
        {resource.language ? <span className="resource-language">{resource.language}</span> : null}
      </div>

      {/* Skip media previews for expired resources */}
      {!resourceIsExpired ? (
        <>
          {resource.type === "video" && resource.url ? (
            <video className="resource-video" controls preload="metadata" src={resource.url} />
          ) : null}

          {resource.type === "audio" && resource.url ? (
            <audio className="resource-audio" controls preload="metadata" src={resource.url} />
          ) : null}

          {resource.type === "image" && resource.url ? (
            <img className="resource-image" src={resource.url} alt={resource.filename} loading="lazy" />
          ) : null}
        </>
      ) : isLargeMedia ? (
        <p style={{ fontSize: 12, color: "var(--muted)", fontStyle: "italic", margin: "8px 0" }}>
          资源已过期，无法预览
        </p>
      ) : null}

      <div className="resource-card-footer">
        {resource.url && !resourceIsExpired ? (
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
