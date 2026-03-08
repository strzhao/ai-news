/**
 * YouTube video extraction using yt-dlp.
 * Also handles Bilibili via the same yt-dlp interface.
 */
import { execFile } from "node:child_process";
import { readdir, readFile, stat } from "node:fs/promises";
import { join, extname } from "node:path";
import { tmpdir } from "node:os";
import { mkdtemp, rm } from "node:fs/promises";
import { uploadFileToBlob } from "../upload.js";

interface ExtractedResource {
  type: string;
  url: string;
  filename: string;
  size_bytes: number;
  mime_type: string;
  language?: string;
  format?: string;
  expires_at?: string;
}

interface ExtractionMetadata {
  title: string;
  description: string;
  author: string;
  duration?: number;
  published_at?: string;
  platform_id?: string;
  tags?: string[];
}

interface ExtractionResult {
  resources: ExtractedResource[];
  metadata: ExtractionMetadata;
}

const MIME_MAP: Record<string, string> = {
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mkv": "video/x-matroska",
  ".m4a": "audio/mp4",
  ".mp3": "audio/mpeg",
  ".opus": "audio/opus",
  ".ogg": "audio/ogg",
  ".srt": "text/srt",
  ".vtt": "text/vtt",
  ".ass": "text/x-ssa",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};

function exec(cmd: string, args: string[], cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { cwd, maxBuffer: 10 * 1024 * 1024, timeout: 300_000 }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(`${cmd} failed: ${error.message}\nstderr: ${stderr}`));
        return;
      }
      resolve(stdout);
    });
  });
}

function guessResourceType(ext: string): string {
  if ([".mp4", ".webm", ".mkv"].includes(ext)) return "video";
  if ([".m4a", ".mp3", ".opus", ".ogg"].includes(ext)) return "audio";
  if ([".srt", ".vtt", ".ass"].includes(ext)) return "subtitle";
  if ([".jpg", ".jpeg", ".png", ".webp"].includes(ext)) return "thumbnail";
  return "metadata";
}

function computeExpiresAt(ttlHours: number): string {
  return new Date(Date.now() + ttlHours * 3600 * 1000).toISOString();
}

export async function extractYouTube(url: string, taskId: string, blobTtlHours: number): Promise<ExtractionResult> {
  const workDir = await mkdtemp(join(tmpdir(), "ytdlp-"));

  try {
    // Step 1: Get metadata (no download)
    const metaJson = await exec("yt-dlp", ["--dump-json", "--no-download", url], workDir);
    const meta = JSON.parse(metaJson);

    const metadata: ExtractionMetadata = {
      title: String(meta.title || ""),
      description: String(meta.description || "").slice(0, 2000),
      author: String(meta.uploader || meta.channel || ""),
      duration: Number(meta.duration) || undefined,
      published_at: String(meta.upload_date || "").replace(/(\d{4})(\d{2})(\d{2})/, "$1-$2-$3") || undefined,
      platform_id: String(meta.id || ""),
      tags: Array.isArray(meta.tags) ? meta.tags.slice(0, 20).map(String) : [],
    };

    // Step 2: Download video + subtitles + thumbnail
    await exec("yt-dlp", [
      "-f", "bestvideo[height<=1080]+bestaudio/best[height<=1080]",
      "--merge-output-format", "mp4",
      "--write-subs",
      "--write-auto-sub",
      "--sub-lang", "en,zh-Hans,zh-Hant,ja,ko",
      "--convert-subs", "srt",
      "--write-thumbnail",
      "--no-playlist",
      "-o", "%(title).80s.%(ext)s",
      url,
    ], workDir);

    // Step 3: Upload all output files to Vercel Blob
    const files = await readdir(workDir);
    const resources: ExtractedResource[] = [];
    const expiresAt = computeExpiresAt(blobTtlHours);

    for (const file of files) {
      const filePath = join(workDir, file);
      const fileStat = await stat(filePath);
      if (!fileStat.isFile()) continue;

      const ext = extname(file).toLowerCase();
      const resourceType = guessResourceType(ext);
      const mimeType = MIME_MAP[ext] || "application/octet-stream";

      const uploaded = await uploadFileToBlob(taskId, filePath, resourceType);

      resources.push({
        type: resourceType,
        url: uploaded.url,
        filename: file,
        size_bytes: uploaded.size_bytes,
        mime_type: mimeType,
        format: resourceType === "video" ? `${meta.height || "?"}p` : undefined,
        language: resourceType === "subtitle" ? guessSubtitleLang(file) : undefined,
        expires_at: expiresAt,
      });
    }

    return { resources, metadata };
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

function guessSubtitleLang(filename: string): string {
  const langPatterns: Array<[RegExp, string]> = [
    [/\.en\./, "en"],
    [/\.zh-Hans\./, "zh-Hans"],
    [/\.zh-Hant\./, "zh-Hant"],
    [/\.zh\./, "zh"],
    [/\.ja\./, "ja"],
    [/\.ko\./, "ko"],
  ];
  for (const [re, lang] of langPatterns) {
    if (re.test(filename)) return lang;
  }
  return "unknown";
}
