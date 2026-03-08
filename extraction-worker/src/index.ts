/**
 * Extraction Worker — polls article-db for pending tasks and processes them.
 *
 * Prerequisites:
 *   - yt-dlp installed (brew install yt-dlp / pip install yt-dlp)
 *   - ffmpeg installed (brew install ffmpeg)
 *   - Environment variables: ARTICLE_DB_BASE_URL, ARTICLE_DB_API_TOKEN, BLOB_TOKEN
 *
 * Usage:
 *   npm start          # run once (process all pending tasks, then exit)
 *   npm run dev         # watch mode with auto-reload
 *
 * For continuous polling, use a cron job or process manager:
 *   crontab: */5 * * * * cd /path/to/extraction-worker && npm start
 */

import { fetchPendingTasks, reportTaskComplete } from "./reporter.js";
import { extractYouTube } from "./extractors/youtube.js";
import { extractBilibili } from "./extractors/bilibili.js";
import { extractXiaohongshu } from "./extractors/xiaohongshu.js";
import { extractInstagram } from "./extractors/instagram.js";

const POLL_MODE = process.argv.includes("--poll");
const POLL_INTERVAL_MS = 30_000;

async function processTask(task: { task_id: string; url: string; platform: string; blob_ttl_hours: number }): Promise<void> {
  console.log(`[${task.task_id}] Processing ${task.platform}: ${task.url}`);

  try {
    let result: { resources: any[]; metadata: any };

    switch (task.platform) {
      case "youtube":
        result = await extractYouTube(task.url, task.task_id, task.blob_ttl_hours);
        break;
      case "bilibili":
        result = await extractBilibili(task.url, task.task_id, task.blob_ttl_hours);
        break;
      case "xiaohongshu":
        result = await extractXiaohongshu(task.url, task.task_id, task.blob_ttl_hours);
        break;
      case "instagram":
        result = await extractInstagram(task.url, task.task_id, task.blob_ttl_hours);
        break;
      default:
        throw new Error(`Unsupported platform: ${task.platform}`);
    }

    console.log(`[${task.task_id}] Extracted ${result.resources.length} resources. Reporting...`);

    await reportTaskComplete(task.task_id, {
      resources: result.resources,
      metadata: result.metadata,
    });

    console.log(`[${task.task_id}] Done.`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[${task.task_id}] Failed: ${message}`);

    await reportTaskComplete(task.task_id, {
      error_message: message.slice(0, 2000),
    }).catch((err) => {
      console.error(`[${task.task_id}] Failed to report error: ${err}`);
    });
  }
}

async function runOnce(): Promise<number> {
  try {
    const tasks = await fetchPendingTasks(5);
    if (!tasks.length) {
      console.log("No pending tasks.");
      return 0;
    }

    console.log(`Found ${tasks.length} pending task(s).`);
    for (const task of tasks) {
      await processTask(task);
    }
    return tasks.length;
  } catch (error) {
    console.error("Error fetching tasks:", error);
    return 0;
  }
}

async function main(): Promise<void> {
  console.log("Extraction Worker started.");
  console.log(`  ARTICLE_DB_BASE_URL: ${process.env.ARTICLE_DB_BASE_URL || "(not set)"}`);
  console.log(`  Mode: ${POLL_MODE ? "continuous polling" : "single run"}`);

  if (!process.env.ARTICLE_DB_BASE_URL) {
    console.error("Error: ARTICLE_DB_BASE_URL is required.");
    process.exit(1);
  }

  if (POLL_MODE) {
    // Continuous polling mode
    while (true) {
      await runOnce();
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    }
  } else {
    // Single run mode (for cron jobs)
    await runOnce();
  }
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
