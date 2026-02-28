import { isEnabled, isTruthy } from "@/lib/infra/route-utils";

function firstQueryValue(url: URL, key: string): string {
  return String(url.searchParams.get(key) || "").trim();
}

export function buildDigestArgv(url: URL, tzName: string, outputDir: string): string[] {
  const targetDate = firstQueryValue(url, "date");
  const ignoreRepeatLimit = isTruthy(firstQueryValue(url, "ignore_repeat_limit"));
  const topN = firstQueryValue(url, "top_n");

  const argv = ["vercel-cron", "--tz", tzName, "--output-dir", outputDir];
  if (targetDate) {
    argv.push("--date", targetDate);
  }
  if (topN) {
    argv.push("--top-n", topN);
  }
  if (ignoreRepeatLimit) {
    argv.push("--ignore-repeat-limit");
  }
  return argv;
}

export function analysisArchiveEnabled(url: URL): boolean {
  const explicit = firstQueryValue(url, "archive_analysis");
  if (explicit) {
    return isTruthy(explicit);
  }
  return isEnabled("ARCHIVE_ANALYSIS_ENABLED", "false");
}
