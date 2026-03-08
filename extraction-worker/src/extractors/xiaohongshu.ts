/**
 * 小红书 content extraction.
 *
 * Uses HTTP fetch to extract content from public Xiaohongshu pages.
 * Falls back to yt-dlp for video notes.
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

export async function extractXiaohongshu(
  url: string,
  taskId: string,
  blobTtlHours: number,
): Promise<{ resources: ExtractedResource[]; metadata: ExtractionMetadata }> {
  const resources: ExtractedResource[] = [];
  const metadata: ExtractionMetadata = {
    title: "",
    description: "",
    author: "",
    tags: [],
  };

  // Step 1: Fetch the page HTML to extract metadata and images
  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
        Accept: "text/html",
      },
      redirect: "follow",
    });

    if (response.ok) {
      const html = await response.text();

      // Extract OG metadata
      metadata.title = extractMeta(html, "og:title") || "小红书笔记";
      metadata.description = extractMeta(html, "og:description") || extractMeta(html, "description") || "";
      metadata.author = extractMeta(html, "og:site_name") || "小红书";

      // Extract hashtags
      const tagMatches = metadata.description.match(/#[^\s#]+/g);
      if (tagMatches) {
        metadata.tags = tagMatches.map((t) => t.replace("#", "")).slice(0, 20);
      }

      // Extract images from OG and page
      const ogImage = extractMeta(html, "og:image");
      if (ogImage) {
        resources.push({
          type: "image",
          url: ogImage,
          filename: "cover.jpg",
          size_bytes: 0,
          mime_type: "image/jpeg",
        });
      }

      // Extract all note images (Xiaohongshu uses specific patterns)
      const imageUrls = extractXhsImages(html);
      const expiresAt = computeExpiresAt(blobTtlHours);
      for (let i = 0; i < imageUrls.length; i++) {
        if (resources.some((r) => r.url === imageUrls[i])) continue;
        resources.push({
          type: "image",
          url: imageUrls[i],
          filename: `image_${i + 1}.jpg`,
          size_bytes: 0,
          mime_type: "image/jpeg",
          expires_at: expiresAt,
        });
      }

      // Text content
      if (metadata.description) {
        resources.push({
          type: "text",
          url: url,
          filename: "content.txt",
          size_bytes: metadata.description.length,
          mime_type: "text/plain",
        });
      }
    }
  } catch {
    // Continue to try yt-dlp for video content
  }

  // Step 2: Try yt-dlp for video notes
  try {
    const workDir = await mkdtemp(join(tmpdir(), "xhs-"));
    try {
      await new Promise<void>((resolve, reject) => {
        execFile(
          "yt-dlp",
          ["-f", "best", "--write-thumbnail", "-o", "%(title).80s.%(ext)s", url],
          { cwd: workDir, timeout: 120_000, maxBuffer: 5 * 1024 * 1024 },
          (error) => {
            if (error) reject(error);
            else resolve();
          },
        );
      });

      const files = await readdir(workDir);
      const expiresAt = computeExpiresAt(blobTtlHours);
      for (const file of files) {
        const filePath = join(workDir, file);
        const fileStat = await stat(filePath);
        if (!fileStat.isFile()) continue;

        const ext = extname(file).toLowerCase();
        const type = [".mp4", ".webm"].includes(ext) ? "video" : "thumbnail";
        const uploaded = await uploadFileToBlob(taskId, filePath, type);

        resources.push({
          type,
          url: uploaded.url,
          filename: file,
          size_bytes: uploaded.size_bytes,
          mime_type: ext === ".mp4" ? "video/mp4" : "image/jpeg",
          expires_at: expiresAt,
        });
      }
    } finally {
      await rm(workDir, { recursive: true, force: true }).catch(() => {});
    }
  } catch {
    // yt-dlp may not support all Xiaohongshu URLs
  }

  return { resources, metadata };
}

function extractMeta(html: string, property: string): string {
  const re = new RegExp(
    `<meta\\b[^>]*(?:property|name)\\s*=\\s*["']${property}["'][^>]*content\\s*=\\s*["']([^"']*)["']`,
    "i",
  );
  const match = re.exec(html);
  if (match) return match[1] || "";

  const re2 = new RegExp(
    `<meta\\b[^>]*content\\s*=\\s*["']([^"']*)["'][^>]*(?:property|name)\\s*=\\s*["']${property}["']`,
    "i",
  );
  const match2 = re2.exec(html);
  return match2 ? match2[1] || "" : "";
}

function extractXhsImages(html: string): string[] {
  const urls: string[] = [];
  // Look for image URLs in Xiaohongshu's typical patterns
  const imgRe = /https?:\/\/[^"'\s]+\.(?:jpg|jpeg|png|webp)(?:\?[^"'\s]*)?/gi;
  let match: RegExpExecArray | null = null;
  while ((match = imgRe.exec(html)) !== null) {
    const src = match[0];
    if (src.includes("sns-img") || src.includes("xhscdn") || src.includes("ci.xiaohongshu")) {
      urls.push(src);
    }
  }
  return [...new Set(urls)].slice(0, 24);
}
