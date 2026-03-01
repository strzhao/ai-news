import Link from "next/link";
import { revalidatePath } from "next/cache";
import { listArchivedArticles, recordArticleQualityFeedback } from "@/lib/article-db/repository";
import styles from "./page.module.css";

export const runtime = "nodejs";
export const maxDuration = 300;
export const preferredRegion = ["sin1"];
export const dynamic = "force-dynamic";

type SearchParams = Record<string, string | string[] | undefined>;

function pickString(input: string | string[] | undefined): string {
  if (Array.isArray(input)) {
    return String(input[0] || "").trim();
  }
  return String(input || "").trim();
}

function dateShift(daysAgo: number, timezoneName: string): string {
  const now = new Date(Date.now() - daysAgo * 86_400_000);
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezoneName,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const [{ value: year }, , { value: month }, , { value: day }] = formatter.formatToParts(now);
  return `${year}-${month}-${day}`;
}

function clampInt(raw: string, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(String(raw || fallback), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(parsed, max));
}

function normalizeQualityTier(raw: string): "high" | "general" | "all" {
  const value = String(raw || "").trim().toLowerCase();
  if (["high", "hq", "default"].includes(value)) return "high";
  if (["general", "normal", "common", "non_high"].includes(value)) return "general";
  return "all";
}

function formatDateTime(value: string): string {
  if (!value) return "-";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    hour12: false,
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(parsed);
}

function compactJson(value: Record<string, string[]>): string {
  const parts = Object.entries(value || {})
    .map(([group, tags]) => {
      const items = (tags || []).filter(Boolean);
      if (!items.length) return "";
      return `${group}:${items.join(",")}`;
    })
    .filter(Boolean);
  return parts.join(" | ");
}

function buildPageHref(params: {
  from: string;
  to: string;
  qualityTier: "high" | "general" | "all";
  q: string;
  sourceId: string;
  primaryType: string;
  limit: number;
  offset: number;
}): string {
  const query = new URLSearchParams();
  query.set("from", params.from);
  query.set("to", params.to);
  query.set("quality_tier", params.qualityTier);
  if (params.q) query.set("q", params.q);
  if (params.sourceId) query.set("source_id", params.sourceId);
  if (params.primaryType) query.set("primary_type", params.primaryType);
  query.set("limit", String(params.limit));
  query.set("offset", String(Math.max(0, params.offset)));
  return `/archive-review?${query.toString()}`;
}

async function submitQualityFeedback(formData: FormData): Promise<void> {
  "use server";

  const articleId = String(formData.get("article_id") || "").trim();
  const feedback = String(formData.get("feedback") || "").trim().toLowerCase();
  const returnTo = String(formData.get("return_to") || "/archive-review").trim() || "/archive-review";
  if (!articleId || !["good", "bad"].includes(feedback)) {
    return;
  }

  await recordArticleQualityFeedback({
    articleId,
    feedback,
    source: "archive_review_page",
    contextJson: {
      return_to: returnTo,
      feedback,
    },
  });

  revalidatePath("/archive-review");
}

export default async function ArchiveReviewPage(props: {
  searchParams?: Promise<SearchParams>;
}): Promise<React.ReactNode> {
  const timezoneName = String(process.env.DIGEST_TIMEZONE || "Asia/Shanghai").trim() || "Asia/Shanghai";
  const resolvedSearchParams = (await props.searchParams) || {};
  const from = pickString(resolvedSearchParams.from) || dateShift(29, timezoneName);
  const to = pickString(resolvedSearchParams.to) || dateShift(0, timezoneName);
  const q = pickString(resolvedSearchParams.q).slice(0, 160);
  const sourceId = pickString(resolvedSearchParams.source_id).slice(0, 80);
  const primaryType = pickString(resolvedSearchParams.primary_type).slice(0, 80);
  const qualityTier = normalizeQualityTier(pickString(resolvedSearchParams.quality_tier));
  const limit = clampInt(pickString(resolvedSearchParams.limit), 80, 10, 200);
  const offset = clampInt(pickString(resolvedSearchParams.offset), 0, 0, 20_000);

  const normalizedFrom = from <= to ? from : to;
  const normalizedTo = from <= to ? to : from;
  const returnTo = buildPageHref({
    from: normalizedFrom,
    to: normalizedTo,
    qualityTier,
    q,
    sourceId,
    primaryType,
    limit,
    offset,
  });

  const result = await listArchivedArticles({
    fromDate: normalizedFrom,
    toDate: normalizedTo,
    limit,
    offset,
    qualityTier,
    search: q || undefined,
    sourceId: sourceId || undefined,
    primaryType: primaryType || undefined,
  });

  const total = result.total;
  const start = total ? offset + 1 : 0;
  const end = Math.min(total, offset + limit);
  const prevHref = offset > 0 ? buildPageHref({
    from: normalizedFrom,
    to: normalizedTo,
    qualityTier,
    q,
    sourceId,
    primaryType,
    limit,
    offset: Math.max(0, offset - limit),
  }) : "";
  const nextHref = offset + limit < total ? buildPageHref({
    from: normalizedFrom,
    to: normalizedTo,
    qualityTier,
    q,
    sourceId,
    primaryType,
    limit,
    offset: offset + limit,
  }) : "";

  return (
    <main className={styles.shell}>
      <header className={styles.hero}>
        <div>
          <p className={styles.eyebrow}>Archive Review Console</p>
          <h1>归档文章审查与反馈</h1>
          <p className={styles.meta}>
            时间范围 {normalizedFrom} ~ {normalizedTo} · 显示 {start}-{end} / {total}
          </p>
        </div>
        <Link href="/" className={styles.homeLink}>
          返回首页
        </Link>
      </header>

      <form className={styles.filters} method="GET">
        <label>
          从
          <input type="date" name="from" defaultValue={normalizedFrom} />
        </label>
        <label>
          到
          <input type="date" name="to" defaultValue={normalizedTo} />
        </label>
        <label>
          质量层
          <select name="quality_tier" defaultValue={qualityTier}>
            <option value="all">全部</option>
            <option value="high">高质量</option>
            <option value="general">一般质量</option>
          </select>
        </label>
        <label>
          关键词
          <input type="text" name="q" defaultValue={q} placeholder="标题/摘要/理由/链接" />
        </label>
        <label>
          source_id
          <input type="text" name="source_id" defaultValue={sourceId} placeholder="可选" />
        </label>
        <label>
          primary_type
          <input type="text" name="primary_type" defaultValue={primaryType} placeholder="可选" />
        </label>
        <label>
          每页
          <select name="limit" defaultValue={String(limit)}>
            <option value="40">40</option>
            <option value="80">80</option>
            <option value="120">120</option>
            <option value="200">200</option>
          </select>
        </label>
        <input type="hidden" name="offset" value="0" />
        <button type="submit">筛选</button>
      </form>

      <section className={styles.list}>
        {result.items.length ? (
          result.items.map((item) => {
            const tags = compactJson(item.tag_groups);
            return (
              <article key={`${item.date}:${item.article_id}`} className={styles.card}>
                <div className={styles.cardHead}>
                  <h2>
                    <a href={item.info_url || item.original_url} target="_blank" rel="noreferrer noopener">
                      {item.title || "无标题"}
                    </a>
                  </h2>
                  <span className={item.quality_tier === "high" ? styles.badgeHigh : styles.badgeGeneral}>
                    {item.quality_tier === "high" ? "高质量" : "一般"}
                  </span>
                </div>

                <p className={styles.row}>
                  <strong>ID</strong> {item.article_id} · <strong>来源</strong> {item.source_name} ({item.source_id}) ·{" "}
                  <strong>站点</strong> {item.source_host || "-"}
                </p>
                <p className={styles.row}>
                  <strong>归档日</strong> {item.date} · <strong>分析时间</strong> {formatDateTime(item.analyzed_at)} ·{" "}
                  <strong>入选高质量</strong> {item.is_selected ? "是" : "否"}
                </p>
                <p className={styles.row}>
                  <strong>质量分(快照)</strong> {item.quality_score_snapshot.toFixed(2)} · <strong>AI原始分</strong>{" "}
                  {item.quality_score.toFixed(2)} · <strong>置信度</strong> {item.confidence.toFixed(3)}
                </p>
                <p className={styles.row}>
                  <strong>价值</strong> {item.worth || "-"} · <strong>主类型</strong> {item.primary_type || "-"} ·{" "}
                  <strong>次类型</strong> {(item.secondary_types || []).join(", ") || "-"}
                </p>

                {item.one_line_summary ? <p className={styles.summary}>{item.one_line_summary}</p> : null}
                {item.reason_short ? <p className={styles.reason}>理由：{item.reason_short}</p> : null}
                {item.action_hint ? <p className={styles.action}>建议：{item.action_hint}</p> : null}

                <p className={styles.row}>
                  <strong>影响度</strong> 公司 {item.company_impact.toFixed(1)} / 团队 {item.team_impact.toFixed(1)} / 个人{" "}
                  {item.personal_impact.toFixed(1)} / 执行清晰度 {item.execution_clarity.toFixed(1)}
                </p>
                <p className={styles.row}>
                  <strong>新颖度</strong> {item.novelty_score.toFixed(1)} · <strong>清晰度</strong>{" "}
                  {item.clarity_score.toFixed(1)} · <strong>适合角色</strong> {(item.best_for_roles || []).join(", ") || "-"}
                </p>
                <p className={styles.row}>
                  <strong>证据信号</strong> {(item.evidence_signals || []).join(" | ") || "-"}
                </p>
                <p className={styles.row}>
                  <strong>标签组</strong> {tags || "-"}
                </p>
                <p className={styles.row}>
                  <strong>反馈统计</strong> 好 {item.feedback_good_count} · 不好 {item.feedback_bad_count} · 总计{" "}
                  {item.feedback_total_count} · 最近 {item.feedback_last || "-"} ({formatDateTime(item.feedback_last_at)})
                </p>
                <p className={styles.row}>
                  <strong>链接</strong>{" "}
                  <a href={item.canonical_url || item.info_url || item.original_url} target="_blank" rel="noreferrer noopener">
                    canonical/info
                  </a>
                </p>

                <div className={styles.feedbackBar}>
                  <form action={submitQualityFeedback}>
                    <input type="hidden" name="article_id" value={item.article_id} />
                    <input type="hidden" name="feedback" value="good" />
                    <input type="hidden" name="return_to" value={returnTo} />
                    <button type="submit" className={styles.goodBtn}>
                      好
                    </button>
                  </form>
                  <form action={submitQualityFeedback}>
                    <input type="hidden" name="article_id" value={item.article_id} />
                    <input type="hidden" name="feedback" value="bad" />
                    <input type="hidden" name="return_to" value={returnTo} />
                    <button type="submit" className={styles.badBtn}>
                      不好
                    </button>
                  </form>
                </div>
              </article>
            );
          })
        ) : (
          <p className={styles.empty}>当前筛选条件下没有归档文章。</p>
        )}
      </section>

      <footer className={styles.pager}>
        {prevHref ? <Link href={prevHref}>上一页</Link> : <span className={styles.disabled}>上一页</span>}
        {nextHref ? <Link href={nextHref}>下一页</Link> : <span className={styles.disabled}>下一页</span>}
      </footer>
    </main>
  );
}
