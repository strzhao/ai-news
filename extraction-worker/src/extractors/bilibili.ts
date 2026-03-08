/**
 * Bilibili video extraction — delegates to the same yt-dlp workflow as YouTube.
 */
import { extractYouTube } from "./youtube.js";

export async function extractBilibili(url: string, taskId: string, blobTtlHours: number) {
  // yt-dlp natively supports Bilibili
  return extractYouTube(url, taskId, blobTtlHours);
}
