import crypto from "node:crypto";
import { buildUpstashClient, buildUpstashClientOrNone } from "@/lib/domain/tracker-common";

function unwrapPipelineResult(item: unknown): unknown {
  if (item && typeof item === "object" && "result" in item) {
    return (item as { result: unknown }).result;
  }
  return item;
}

function parseHashPayload(raw: unknown): Record<string, string> {
  const payload = unwrapPipelineResult(raw);
  if (!payload) {
    return {};
  }
  if (Array.isArray(payload)) {
    const result: Record<string, string> = {};
    for (let idx = 0; idx < payload.length - 1; idx += 2) {
      const key = String(payload[idx] ?? "").trim();
      if (!key) continue;
      result[key] = String(payload[idx + 1] ?? "");
    }
    return result;
  }
  if (typeof payload === "object") {
    const result: Record<string, string> = {};
    for (const [key, value] of Object.entries(payload as Record<string, unknown>)) {
      const normalized = String(key).trim();
      if (!normalized) continue;
      result[normalized] = String(value ?? "");
    }
    return result;
  }
  return {};
}

function parseListPayload(raw: unknown): string[] {
  const payload = unwrapPipelineResult(raw);
  if (!Array.isArray(payload)) return [];
  return payload.map((item) => String(item).trim()).filter(Boolean);
}

function isoToEpochMs(value: string): number {
  const date = new Date(String(value || "").trim());
  if (Number.isNaN(date.getTime())) {
    return Date.now();
  }
  return date.getTime();
}

function dateScore(reportDate: string): number {
  const digits = String(reportDate || "").replace(/\D/g, "");
  if (digits.length === 8) {
    return Number(digits);
  }
  const date = new Date();
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return Number(`${y}${m}${d}`);
}

function preview(text: string, maxChars = 140): string {
  const normalized = String(text || "").replace(/\s+/g, " ").trim();
  if (!normalized) return "";
  if (normalized.length <= maxChars) return normalized;
  return `${normalized.slice(0, Math.max(1, maxChars - 1)).trimEnd()}…`;
}

export function buildDigestId(reportDate: string, generatedAt: string, markdown: string): string {
  const epochMs = isoToEpochMs(generatedAt);
  const digestHash = crypto.createHash("sha256").update(String(markdown || "")).digest("hex").slice(0, 8);
  return `${reportDate}_${epochMs}_${digestHash}`;
}

export async function saveDigestArchive(params: {
  digestId: string;
  reportDate: string;
  generatedAt: string;
  markdown: string;
  highlightCount: number;
  hasHighlights: boolean;
  summaryPreview: string;
}): Promise<void> {
  const upstash = buildUpstashClient();
  const entryKey = `digest:entry:${params.digestId}`;
  const dateKey = `digest:date:${params.reportDate}`;
  await upstash.hset(entryKey, {
    digest_id: params.digestId,
    date: params.reportDate,
    generated_at: params.generatedAt,
    highlight_count: Math.trunc(params.highlightCount),
    has_highlights: params.hasHighlights ? "1" : "0",
    summary_preview: preview(params.summaryPreview, 180),
    markdown: params.markdown,
  });
  await upstash.zadd(dateKey, isoToEpochMs(params.generatedAt), params.digestId);
  await upstash.zadd("digest:dates", dateScore(params.reportDate), params.reportDate);
}

export async function saveAnalysisArchive(params: {
  digestId: string;
  reportDate: string;
  generatedAt: string;
  analysisMarkdown: string;
  analysisJson: Record<string, unknown>;
}): Promise<void> {
  const upstash = buildUpstashClient();
  const analysisKey = `digest:analysis:${params.digestId}`;
  const improvement = params.analysisJson.improvement_actions as Record<string, unknown> | undefined;
  const previewSource = String(improvement?.ai_summary || params.analysisMarkdown || "");
  await upstash.hset(analysisKey, {
    digest_id: params.digestId,
    date: params.reportDate,
    generated_at: params.generatedAt,
    analysis_preview: preview(previewSource, 180),
    analysis_markdown: params.analysisMarkdown,
    analysis_json: JSON.stringify(params.analysisJson),
  });
}

export async function listArchives(days = 30, limitPerDay = 10): Promise<Array<Record<string, unknown>>> {
  const boundedDays = Math.max(1, Math.min(Math.trunc(days), 180));
  const boundedLimit = Math.max(1, Math.min(Math.trunc(limitPerDay), 50));
  const upstash = buildUpstashClientOrNone();
  if (!upstash) {
    return [];
  }

  const dateRows = await upstash.pipeline([["ZREVRANGE", "digest:dates", 0, boundedDays - 1]]);
  const dates = parseListPayload(dateRows[0]);
  if (!dates.length) {
    return [];
  }

  const idCommands: Array<Array<string | number>> = dates.map((date) => ["ZREVRANGE", `digest:date:${date}`, 0, boundedLimit - 1]);
  const idRows = await upstash.pipeline(idCommands);

  const allDigestIds: string[] = [];
  const byDateIds: Record<string, string[]> = {};
  dates.forEach((date, idx) => {
    const digestIds = parseListPayload(idRows[idx]);
    byDateIds[date] = digestIds;
    allDigestIds.push(...digestIds);
  });

  if (!allDigestIds.length) {
    return [];
  }

  const entryRows = await upstash.pipeline(allDigestIds.map((digestId) => ["HGETALL", `digest:entry:${digestId}`]));
  const analysisRows = await upstash.pipeline(allDigestIds.map((digestId) => ["HGETALL", `digest:analysis:${digestId}`]));

  const entries: Record<string, Record<string, string>> = {};
  const analysisEntries: Record<string, Record<string, string>> = {};

  allDigestIds.forEach((digestId, idx) => {
    const row = parseHashPayload(entryRows[idx]);
    if (Object.keys(row).length) entries[digestId] = row;
    const analysis = parseHashPayload(analysisRows[idx]);
    if (Object.keys(analysis).length) analysisEntries[digestId] = analysis;
  });

  const groups: Array<Record<string, unknown>> = [];
  for (const date of dates) {
    const items: Array<Record<string, unknown>> = [];
    for (const digestId of byDateIds[date] || []) {
      const row = entries[digestId];
      if (!row) continue;
      const highlightCount = Number(row.highlight_count || 0);
      const hasHighlights = ["1", "true", "yes", "on"].includes(String(row.has_highlights || "").toLowerCase());
      items.push({
        digest_id: digestId,
        date: row.date || date,
        generated_at: row.generated_at || "",
        highlight_count: Number.isFinite(highlightCount) ? Math.trunc(highlightCount) : 0,
        has_highlights: hasHighlights,
        summary_preview: row.summary_preview || "",
        analysis_preview: (analysisEntries[digestId] || {}).analysis_preview || "",
        view_url: `/api/archive_item?id=${encodeURIComponent(digestId)}`,
        analysis_url: `/api/archive_analysis?id=${encodeURIComponent(digestId)}`,
      });
    }
    if (items.length) {
      groups.push({ date, items });
    }
  }

  return groups;
}

export async function getArchiveItem(digestId: string): Promise<Record<string, unknown> | null> {
  const normalized = String(digestId || "").trim();
  if (!normalized) return null;
  const upstash = buildUpstashClientOrNone();
  if (!upstash) {
    return null;
  }
  const row = await upstash.hgetall(`digest:entry:${normalized}`);
  if (!Object.keys(row).length) {
    return null;
  }
  const highlightCount = Number(row.highlight_count || 0);
  const hasHighlights = ["1", "true", "yes", "on"].includes(String(row.has_highlights || "").toLowerCase());
  return {
    digest_id: normalized,
    date: row.date || "",
    generated_at: row.generated_at || "",
    highlight_count: Number.isFinite(highlightCount) ? Math.trunc(highlightCount) : 0,
    has_highlights: hasHighlights,
    summary_preview: row.summary_preview || "",
    markdown: row.markdown || "",
  };
}

export async function getArchiveAnalysis(digestId: string): Promise<Record<string, unknown> | null> {
  const normalized = String(digestId || "").trim();
  if (!normalized) return null;
  const upstash = buildUpstashClientOrNone();
  if (!upstash) {
    return null;
  }
  const row = await upstash.hgetall(`digest:analysis:${normalized}`);
  if (!Object.keys(row).length) {
    return null;
  }
  let parsedJson: Record<string, unknown> = {};
  try {
    const raw = JSON.parse(row.analysis_json || "{}");
    if (raw && typeof raw === "object") {
      parsedJson = raw as Record<string, unknown>;
    }
  } catch {
    parsedJson = {};
  }
  return {
    digest_id: normalized,
    date: row.date || "",
    generated_at: row.generated_at || "",
    analysis_preview: row.analysis_preview || "",
    analysis_markdown: row.analysis_markdown || "",
    analysis_json: parsedJson,
  };
}
