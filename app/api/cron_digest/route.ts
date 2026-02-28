import { buildDigestId, saveAnalysisArchive, saveDigestArchive } from "@/lib/domain/archive-store";
import { runDigestWithResult } from "@/lib/digest-runner";
import { countHighlights, firstNonEmptyLine, isEnabled, isTruthy, jsonResponse } from "@/lib/infra/route-utils";
import { analysisArchiveEnabled, buildDigestArgv } from "@/lib/routes/cron-digest-helpers";

export const runtime = "nodejs";
export const maxDuration = 300;

function firstQueryValue(url: URL, key: string): string {
  return String(url.searchParams.get(key) || "").trim();
}

function reportDate(url: URL, tzName: string): string {
  const target = firstQueryValue(url, "date");
  if (target) {
    return target;
  }
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: tzName,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const [{ value: year }, , { value: month }, , { value: day }] = formatter.formatToParts(new Date());
  return `${year}-${month}-${day}`;
}

function runtimeEnvOverrides(url: URL): Record<string, string> {
  const overrides: Record<string, string> = {};
  const maxEvalArticles = firstQueryValue(url, "max_eval_articles");
  if (maxEvalArticles) {
    const numeric = Number.parseInt(maxEvalArticles, 10);
    if (Number.isFinite(numeric)) {
      const bounded = Math.max(1, Math.min(numeric, 200));
      overrides.MAX_EVAL_ARTICLES = String(bounded);
    }
  }

  const analysisAiSummary = firstQueryValue(url, "analysis_ai_summary");
  if (analysisAiSummary) {
    overrides.ANALYSIS_AI_SUMMARY_ENABLED = isTruthy(analysisAiSummary) ? "true" : "false";
  }

  return overrides;
}

function isAuthorized(request: Request, url: URL): boolean {
  const cronSecret = String(process.env.CRON_SECRET || "").trim();
  const authHeader = String(request.headers.get("authorization") || "").trim();
  const queryToken = firstQueryValue(url, "token");

  if (cronSecret) {
    if (authHeader === `Bearer ${cronSecret}`) {
      return true;
    }
    return queryToken === cronSecret;
  }

  const manualToken = String(process.env.DIGEST_MANUAL_TOKEN || "").trim();
  if (!manualToken) {
    return true;
  }
  return queryToken === manualToken;
}

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);

  if (!isAuthorized(request, url)) {
    return jsonResponse(401, { ok: false, error: "Unauthorized" });
  }

  const startedAt = new Date().toISOString();
  const tzName = String(process.env.DIGEST_TIMEZONE || "Asia/Shanghai").trim() || "Asia/Shanghai";
  const outputDir = String(process.env.DIGEST_OUTPUT_DIR || "/tmp/reports").trim() || "/tmp/reports";
  const currentReportDate = reportDate(url, tzName);
  process.env.AI_EVAL_CACHE_DB = process.env.AI_EVAL_CACHE_DB || "/tmp/ai-news/article_eval.sqlite3";

  const argv = buildDigestArgv(url, tzName, outputDir);
  const envOverrides = runtimeEnvOverrides(url);

  const startedAtTs = Date.now();

  const originalEnv: Record<string, string | undefined> = {};
  Object.entries(envOverrides).forEach(([key, value]) => {
    originalEnv[key] = process.env[key];
    process.env[key] = value;
  });

  try {
    const runResult = await runDigestWithResult({
      date: firstQueryValue(url, "date") || undefined,
      tz: tzName,
      topN: Number.parseInt(firstQueryValue(url, "top_n"), 10) || undefined,
      outputDir,
      ignoreRepeatLimit: isTruthy(firstQueryValue(url, "ignore_repeat_limit")),
    });

    const elapsedMs = Date.now() - startedAtTs;
    const exitCode = Number(runResult.exitCode || 1);

    let highlightCount: number | null = null;
    if (runResult.reportMarkdown) {
      highlightCount = countHighlights(runResult.reportMarkdown);
    }

    const digestId = runResult.reportMarkdown
      ? buildDigestId(currentReportDate, new Date().toISOString(), runResult.reportMarkdown)
      : "";

    let archiveSaved = false;
    let analysisArchiveSaved = false;
    const analysisArchive = analysisArchiveEnabled(url);
    let archiveError = "";

    if (exitCode === 0 && isEnabled("ARCHIVE_ENABLED", "true") && runResult.reportMarkdown) {
      const generatedAt = new Date().toISOString();
      const stableDigestId = buildDigestId(currentReportDate, generatedAt, runResult.reportMarkdown);

      try {
        await saveDigestArchive({
          digestId: stableDigestId,
          reportDate: currentReportDate,
          generatedAt,
          markdown: runResult.reportMarkdown,
          highlightCount: Number(highlightCount || 0),
          hasHighlights: Boolean(highlightCount && highlightCount > 0),
          summaryPreview: firstNonEmptyLine(runResult.topSummary),
        });

        if (analysisArchive && runResult.analysisMarkdown && runResult.analysisJson) {
          await saveAnalysisArchive({
            digestId: stableDigestId,
            reportDate: currentReportDate,
            generatedAt,
            analysisMarkdown: runResult.analysisMarkdown,
            analysisJson: runResult.analysisJson,
          });
          analysisArchiveSaved = true;
        }
        archiveSaved = true;
      } catch (error) {
        archiveError = error instanceof Error ? error.message : String(error);
      }
    }

    const status = exitCode === 0 ? 200 : 500;
    return jsonResponse(status, {
      ok: exitCode === 0,
      exit_code: exitCode,
      started_at: startedAt,
      elapsed_ms: Number(elapsedMs.toFixed(2)),
      argv,
      report_date: currentReportDate,
      report_path: runResult.reportPath,
      highlight_count: highlightCount,
      has_highlights: Boolean(highlightCount && highlightCount > 0),
      digest_id: digestId,
      archive_saved: archiveSaved,
      analysis_archive_enabled: analysisArchive,
      analysis_archive_saved: analysisArchiveSaved,
      archive_error: archiveError,
    });
  } catch (error) {
    return jsonResponse(500, {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      started_at: startedAt,
    });
  } finally {
    Object.entries(originalEnv).forEach(([key, value]) => {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    });
  }
}
