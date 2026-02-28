import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";
import { SourceConfig } from "@/lib/domain/models";

const DEFAULT_CONFIG_DIR = path.join(process.cwd(), "config");

export function loadYaml(filePath: string): Record<string, unknown> {
  const raw = fs.readFileSync(filePath, "utf-8");
  const data = (yaml.load(raw) || {}) as unknown;
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error(`YAML root must be a mapping: ${filePath}`);
  }
  return data as Record<string, unknown>;
}

function joinBaseAndRoute(baseUrl: string, route: string): string {
  const base = baseUrl.trim().replace(/\/$/, "");
  const clean = route.trim().startsWith("/") ? route.trim() : `/${route.trim()}`;
  return `${base}${clean}`;
}

function normalizeSourceUrl(rawUrl: string): string {
  const url = rawUrl.trim();
  try {
    const parsed = new URL(url);
    const entries = Array.from(parsed.searchParams.entries()).map(([k, v]) => [k.toLowerCase(), v] as [string, string]);
    entries.sort(([a], [b]) => a.localeCompare(b));
    const normalized = new URL(parsed.toString());
    normalized.protocol = parsed.protocol.toLowerCase();
    normalized.hostname = parsed.hostname.toLowerCase();
    normalized.pathname = (parsed.pathname.replace(/\/$/, "") || "/").toLowerCase();
    normalized.hash = "";
    normalized.search = new URLSearchParams(entries).toString();
    return normalized.toString();
  } catch {
    return url.toLowerCase().replace(/\/$/, "");
  }
}

export function loadSources(sourcePath?: string): SourceConfig[] {
  const configPath = sourcePath || path.join(DEFAULT_CONFIG_DIR, "sources.yaml");
  const raw = loadYaml(configPath);
  const sourceRows = Array.isArray(raw.sources) ? raw.sources : [];

  const sources: SourceConfig[] = [];
  const seenIds = new Set<string>();
  const seenUrls = new Set<string>();

  for (const row of sourceRows) {
    if (!row || typeof row !== "object") continue;
    const record = row as Record<string, unknown>;
    const sourceId = String(record.id || "").trim();
    if (!sourceId || seenIds.has(sourceId)) {
      continue;
    }

    let url = "";
    const rsshubRoute = String(record.rsshub_route || "").trim();
    if (rsshubRoute) {
      const base = String(process.env.RSSHUB_BASE_URL || "").trim();
      if (!base) {
        continue;
      }
      url = joinBaseAndRoute(base, rsshubRoute);
    } else {
      url = String(record.url || "").trim();
    }

    if (!url) {
      continue;
    }

    const normalizedUrl = normalizeSourceUrl(url);
    if (seenUrls.has(normalizedUrl)) {
      continue;
    }

    sources.push({
      id: sourceId,
      name: String(record.name || "").trim() || sourceId,
      url,
      sourceWeight: Number(record.source_weight ?? 1.0) || 1.0,
      sourceType: String(record.source_type || "").trim() || null,
      onlyExternalLinks: Boolean(record.only_external_links || false),
    });

    seenIds.add(sourceId);
    seenUrls.add(normalizedUrl);
  }

  return sources;
}

export function loadScoring(scoringPath?: string): Record<string, unknown> {
  const configPath = scoringPath || path.join(DEFAULT_CONFIG_DIR, "scoring.yaml");
  return loadYaml(configPath);
}

export function loadTagging(taggingPath?: string): Record<string, unknown> {
  const configPath = taggingPath || path.join(DEFAULT_CONFIG_DIR, "tagging.yaml");
  return loadYaml(configPath);
}

export function loadArticleTypes(articleTypesPath?: string): string[] {
  const configPath = articleTypesPath || path.join(DEFAULT_CONFIG_DIR, "article_types.yaml");
  const raw = loadYaml(configPath);
  const rows = Array.isArray(raw.types) ? raw.types : null;
  if (!rows) {
    throw new Error(`types must be a list: ${configPath}`);
  }
  const cleaned = rows.map((item) => String(item || "").trim()).filter(Boolean);
  if (!cleaned.length) {
    throw new Error(`types cannot be empty: ${configPath}`);
  }
  const deduped = Array.from(new Set(cleaned));
  if (!deduped.includes("other")) {
    deduped.push("other");
  }
  return deduped;
}
