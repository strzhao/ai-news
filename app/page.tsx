"use client";

import { useEffect, useMemo, useState } from "react";

const ARCHIVE_TZ = "Asia/Shanghai";
const READ_STORAGE_KEY = "ai_news_read_digest_ids_v1";
const TYPE_LABELS: Record<string, string> = {
  model_release: "模型发布",
  benchmark: "基准评测",
  engineering_practice: "工程实践",
  agent_workflow: "Agent 工作流",
  inference_optimization: "推理优化",
  cost_optimization: "成本优化",
  data_engineering: "数据工程",
  security_compliance: "安全合规",
  product_release: "产品发布",
  open_source_project: "开源项目",
  research_progress: "研究进展",
  other: "其他",
};

interface ArchiveItemSummary {
  digest_id: string;
  date: string;
  generated_at: string;
  highlight_count: number;
  has_highlights: boolean;
  summary_preview: string;
  analysis_preview?: string;
}

interface ArchiveGroup {
  date: string;
  items: ArchiveItemSummary[];
}

interface ArchiveResponse {
  ok: boolean;
  groups: ArchiveGroup[];
  generated_at: string;
}

interface ArchiveDetailResponse {
  ok: boolean;
  item: {
    digest_id: string;
    date: string;
    generated_at: string;
    markdown?: string;
    analysis_markdown?: string;
    analysis_json?: Record<string, unknown>;
  };
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

export default function HomePage(): React.ReactNode {
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState("正在加载文档…");
  const [groups, setGroups] = useState<ArchiveGroup[]>([]);
  const [error, setError] = useState("");
  const [readSet, setReadSet] = useState<Set<string>>(new Set());
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerDigestId, setDrawerDigestId] = useState("");
  const [drawerTitle, setDrawerTitle] = useState("内容详情");
  const [drawerMeta, setDrawerMeta] = useState("");
  const [drawerContent, setDrawerContent] = useState("请选择一份文档。");
  const [drawerTab, setDrawerTab] = useState<"report" | "analysis">("report");
  const [showAnalysis, setShowAnalysis] = useState(false);
  const [days, setDays] = useState(30);
  const [limitPerDay, setLimitPerDay] = useState(10);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setShowAnalysis(params.get("show_analysis") === "1");
    setDays(Math.max(1, Math.min(180, Number.parseInt(params.get("days") || "30", 10) || 30)));
    setLimitPerDay(
      Math.max(1, Math.min(50, Number.parseInt(params.get("limit_per_day") || "10", 10) || 10)),
    );
    setReadSet(loadReadSet());
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadArchive(): Promise<void> {
      setLoading(true);
      setError("");
      try {
        const response = await fetch(`/api/archive?days=${days}&limit_per_day=${limitPerDay}`, {
          cache: "no-store",
        });
        const payload = (await response.json()) as ArchiveResponse;
        if (!response.ok || !payload.ok) {
          throw new Error("加载归档失败");
        }

        if (!cancelled) {
          setGroups(Array.isArray(payload.groups) ? payload.groups : []);
          const count = Array.isArray(payload.groups)
            ? payload.groups.reduce((sum, group) => sum + group.items.length, 0)
            : 0;
          setStatus(`已加载 ${count} 份文档`);
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

    loadArchive();
    return () => {
      cancelled = true;
    };
  }, [days, limitPerDay]);

  const todayDate = useMemo(() => currentDateInTz(), []);

  const todayGroup = useMemo(
    () => groups.find((group) => String(group.date || "").trim() === todayDate) || null,
    [groups, todayDate],
  );

  const todayItems = todayGroup?.items || [];
  const historyGroups = groups.filter((group) => group.date !== todayDate);

  function markDigestRead(digestId: string): void {
    const normalized = String(digestId || "").trim();
    if (!normalized) return;
    setReadSet((prev) => {
      if (prev.has(normalized)) return prev;
      const next = new Set(prev);
      next.add(normalized);
      saveReadSet(next);
      return next;
    });
  }

  async function readContent(digestId: string, tab: "report" | "analysis"): Promise<string> {
    const endpoint =
      tab === "report"
        ? `/api/archive_item?id=${encodeURIComponent(digestId)}`
        : `/api/archive_analysis?id=${encodeURIComponent(digestId)}`;
    const response = await fetch(endpoint, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(tab === "analysis" ? "分析报告读取失败" : "正文读取失败");
    }
    const payload = (await response.json()) as ArchiveDetailResponse;
    if (!payload.ok || !payload.item) {
      throw new Error(tab === "analysis" ? "分析报告不存在" : "正文不存在");
    }
    if (tab === "analysis") {
      return String(payload.item.analysis_markdown || "").trim() || "本次未启用分析归档（默认关闭）。";
    }
    return String(payload.item.markdown || "").trim() || "正文为空。";
  }

  async function openDrawer(item: ArchiveItemSummary): Promise<void> {
    const digestId = String(item.digest_id || "").trim();
    if (!digestId) return;

    markDigestRead(digestId);
    setDrawerDigestId(digestId);
    setDrawerTitle(item.summary_preview || `文档 ${digestId}`);
    setDrawerMeta(`digest_id: ${digestId} · 生成时间: ${formatTime(item.generated_at)}`);
    setDrawerTab("report");
    setDrawerContent("正在加载正文...");
    setDrawerOpen(true);

    try {
      const content = await readContent(digestId, "report");
      setDrawerContent(content);
    } catch (error) {
      setDrawerContent(error instanceof Error ? error.message : String(error));
    }
  }

  async function switchDrawerTab(tab: "report" | "analysis"): Promise<void> {
    setDrawerTab(tab);
    if (!drawerDigestId) return;
    setDrawerContent(tab === "report" ? "正在加载正文..." : "正在加载分析...");
    try {
      const content = await readContent(drawerDigestId, tab);
      setDrawerContent(content);
    } catch (error) {
      setDrawerContent(error instanceof Error ? error.message : String(error));
    }
  }

  function renderCard(item: ArchiveItemSummary): React.ReactNode {
    const digestId = String(item.digest_id || "").trim();
    const read = readSet.has(digestId);
    return (
      <article key={digestId} className={`doc-card${read ? " is-read" : ""}`}>
        <div className="doc-top">
          <span className="doc-time">{formatTime(item.generated_at)}</span>
          <div className="doc-top-right">
            {read ? <span className="doc-read">已读</span> : null}
            <span className="doc-badge">重点 {Number(item.highlight_count || 0)}</span>
          </div>
        </div>
        <p className="doc-preview">{item.summary_preview || "暂无摘要"}</p>
        <div className="doc-meta">
          <div className="doc-meta-row">
            <span className="doc-meta-label">类型</span>
            <div className="doc-chips">
              {(item.analysis_preview || "")
                .split(/\s+/)
                .filter(Boolean)
                .slice(0, 3)
                .map((token) => (
                  <span className="doc-chip" key={`${digestId}-${token}`}>
                    {TYPE_LABELS[token] || token}
                  </span>
                ))}
              {!item.analysis_preview ? <span className="doc-chip doc-chip-muted">暂无</span> : null}
            </div>
          </div>
        </div>
        <div className="doc-actions">
          <button className="btn btn-primary" type="button" onClick={() => void openDrawer(item)}>
            查看正文
          </button>
          {showAnalysis ? (
            <button
              className="btn"
              type="button"
              onClick={() => {
                void openDrawer(item).then(() => switchDrawerTab("analysis"));
              }}
            >
              查看分析
            </button>
          ) : null}
        </div>
      </article>
    );
  }

  return (
    <main className="shell">
      <section className="hero">
        <h1>AI News</h1>
        <div className="hero-meta">
          {todayDate} · {ARCHIVE_TZ} · 共 {groups.length} 天归档
        </div>
      </section>

      <div className="status">{loading ? "正在加载文档…" : status}</div>

      <section className="section">
        <header className="section-head">
          <h2>今日文档</h2>
          <div className="section-meta">{todayItems.length} 份</div>
        </header>
        <div className="today-list">
          {todayItems.length ? todayItems.map((item) => renderCard(item)) : <div className="empty">今日暂无文档。</div>}
        </div>
      </section>

      <section className="section">
        <header className="section-head">
          <h2>历史归档</h2>
          <div className="section-meta">{historyGroups.length} 天</div>
        </header>
        <div className="history-groups">
          {historyGroups.length ? (
            historyGroups.map((group) => (
              <div key={group.date} className="history-group">
                <div className="history-group-head">
                  <h3 className="history-group-title">{group.date}</h3>
                  <div className="history-group-count">{group.items.length} 份</div>
                </div>
                <div className="history-items">{group.items.map((item) => renderCard(item))}</div>
              </div>
            ))
          ) : (
            <div className="empty">暂无历史归档。</div>
          )}
        </div>
      </section>

      {error ? <div className="error">{error}</div> : null}

      <aside className={`drawer-root${drawerOpen ? " open" : ""}`} aria-hidden={!drawerOpen}>
        <div className="drawer-mask" onClick={() => setDrawerOpen(false)} />
        <section className="drawer" role="dialog" aria-modal="true" aria-labelledby="drawerTitle">
          <header className="drawer-head">
            <div className="drawer-top">
              <div>
                <h3 id="drawerTitle" className="drawer-title">
                  {drawerTitle}
                </h3>
                <div className="drawer-meta">{drawerMeta}</div>
              </div>
              <button className="drawer-close" type="button" onClick={() => setDrawerOpen(false)}>
                关闭
              </button>
            </div>
            <div className="drawer-tabs">
              <button
                className={`drawer-tab${drawerTab === "report" ? " active" : ""}`}
                type="button"
                onClick={() => void switchDrawerTab("report")}
              >
                日报正文
              </button>
              {showAnalysis ? (
                <button
                  className={`drawer-tab${drawerTab === "analysis" ? " active" : ""}`}
                  type="button"
                  onClick={() => void switchDrawerTab("analysis")}
                >
                  分析报告
                </button>
              ) : null}
            </div>
          </header>
          <pre className="drawer-content">{drawerContent}</pre>
          <div className="drawer-note">内容来自归档 API，默认优先显示日报正文。</div>
        </section>
      </aside>
    </main>
  );
}
