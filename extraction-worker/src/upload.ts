/**
 * Upload extracted files to Vercel Blob.
 */
import { put } from "@vercel/blob";
import { readFile } from "node:fs/promises";
import { basename } from "node:path";

interface UploadResult {
  url: string;
  filename: string;
  size_bytes: number;
}

export async function uploadFileToBlob(
  taskId: string,
  filePath: string,
  resourceType: string,
): Promise<UploadResult> {
  const filename = basename(filePath);
  const blobPath = `extractions/${taskId}/${resourceType}/${filename}`;
  const fileBuffer = await readFile(filePath);

  const blob = await put(blobPath, fileBuffer, {
    access: "public",
    addRandomSuffix: false,
  });

  return {
    url: blob.url,
    filename,
    size_bytes: fileBuffer.length,
  };
}

export async function uploadBufferToBlob(
  taskId: string,
  buffer: Buffer,
  filename: string,
  resourceType: string,
): Promise<UploadResult> {
  const blobPath = `extractions/${taskId}/${resourceType}/${filename}`;

  const blob = await put(blobPath, buffer, {
    access: "public",
    addRandomSuffix: false,
  });

  return {
    url: blob.url,
    filename,
    size_bytes: buffer.length,
  };
}
