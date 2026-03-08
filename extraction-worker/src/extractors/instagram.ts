/**
 * Instagram content extraction.
 *
 * Extracts images, videos, and metadata from public Instagram posts.
 * Uses yt-dlp which has built-in Instagram support.
 */
import { execFile } from "node:child_process";
import { tmpdir } from "node:os";
import { mkdtemp, rm, readdir, stat } from "node:fs/promises";
import { join, extname } from "node:path";
import { uploadFileToBlob } from "../upload.js";

interface ExtractedResource {
  type: string;
  url: string;
  filename: string;
  size_bytes: number;
  mime_type: string;
  expires_at?: string;
}

interface ExtractionMetadata {
  title: string;
  description: string;
  author: string;
  tags?: string[];
  platform_id?: string;
}

function computeExpiresAt(ttlHours: number): string {
  return new Date(Date.now() + ttlHours * 3600 * 1000).toISOString();
}

function exec(cmd: string, args: string[], cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { cwd, maxBuffer: 10 * 1024 * 1024, timeout: 120_000 }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(`${cmd} failed: ${error.message}\nstderr: ${stderr}`));
        return;
      }
      resolve(stdout);
    });
  });
}

export async function extractInstagram(
  url: string,
  taskId: string,
  blobTtlHours: number,
): Promise<{ resources: ExtractedResource[]; metadata: ExtractionMetadata }> {
  const workDir = await mkdtemp(join(tmpdir(), "insta-"));

  try {
    // Get metadata
    let metadata: ExtractionMetadata = {
      title: "Instagram Post",
      description: "",
      author: "",
      tags: [],
    };

    try {
      const metaJson = await exec("yt-dlp", ["--dump-json", "--no-download", url], workDir);
      const meta = JSON.parse(metaJson);
      metadata = {
        title: String(meta.title || meta.description || "Instagram Post").slice(0, 200),
        description: String(meta.description || "").slice(0, 2000),
        author: String(meta.uploader || meta.channel || ""),
        platform_id: String(meta.id || ""),
        tags: Array.isArray(meta.tags) ? meta.tags.slice(0, 20).map(String) : [],
      };
    } catch {
      // Metadata extraction might fail, continue with download
    }

    // Download content
    await exec("yt-dlp", [
      "-f", "best",
      "--write-thumbnail",
      "--no-playlist",
      "-o", "%(title).80s.%(ext)s",
      url,
    ], workDir);

    const files = await readdir(workDir);
    const resources: ExtractedResource[] = [];
    const expiresAt = computeExpiresAt(blobTtlHours);

    for (const file of files) {
      const filePath = join(workDir, file);
      const fileStat = await stat(filePath);
      if (!fileStat.isFile()) continue;

      const ext = extname(file).toLowerCase();
      let type = "image";
      let mimeType = "image/jpeg";

      if ([".mp4", ".webm"].includes(ext)) {
        type = "video";
        mimeType = ext === ".mp4" ? "video/mp4" : "video/webm";
      } else if ([".jpg", ".jpeg", ".png", ".webp"].includes(ext)) {
        type = "image";
        mimeType = ext === ".png" ? "image/png" : ext === ".webp" ? "image/webp" : "image/jpeg";
      }

      const uploaded = await uploadFileToBlob(taskId, filePath, type);

      resources.push({
        type,
        url: uploaded.url,
        filename: file,
        size_bytes: uploaded.size_bytes,
        mime_type: mimeType,
        expires_at: expiresAt,
      });
    }

    return { resources, metadata };
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}
