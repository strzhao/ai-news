import { NextResponse } from "next/server";

export function jsonResponse(status: number, payload: Record<string, unknown>, noStore = false): NextResponse {
  const response = NextResponse.json(payload, { status });
  if (noStore) {
    response.headers.set("Cache-Control", "no-store, max-age=0");
  }
  return response;
}

export function isTruthy(raw: string): boolean {
  return ["1", "true", "yes", "on"].includes(String(raw || "").trim().toLowerCase());
}

export function isEnabled(envName: string, defaultValue = "true"): boolean {
  const raw = String(process.env[envName] || defaultValue || "").trim().toLowerCase();
  return !["0", "false", "no", "off"].includes(raw);
}

export function firstNonEmptyLine(text: string): string {
  const lines = String(text || "").split(/\r?\n/);
  for (const line of lines) {
    const value = line.trim();
    if (value) return value;
  }
  return "";
}

export function countHighlights(markdown: string): number {
  return String(markdown || "")
    .split(/\r?\n/)
    .filter((line) => line.startsWith("### ")).length;
}
