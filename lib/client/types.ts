export interface AuthUser {
  id: string;
  email: string;
  status: string;
}

export interface FlomoConfig {
  webhook_url: string;
  webhook_url_masked: string;
  updated_at: string;
  status: string;
}

export interface FlomoPushLogEntry {
  date: string;
  article_count: number;
  pushed_at: string;
}

export interface FlomoPushStats {
  total: number;
  recent: FlomoPushLogEntry[];
}

export interface FlomoClickStats {
  total_clicks: number;
  days: number;
  daily: Array<{ date: string; clicks: number }>;
}

export type ExtractionPlatform = "youtube" | "bilibili" | "twitter" | "xiaohongshu" | "instagram" | "wechat" | "webpage" | "unknown";
export type ExtractionStatus = "pending" | "processing" | "completed" | "failed";
export type ResourceType = "video" | "audio" | "subtitle" | "thumbnail" | "image" | "text" | "metadata";

export interface ExtractedResource {
  type: ResourceType;
  url: string;
  filename: string;
  size_bytes: number;
  mime_type: string;
  language?: string;
  format?: string;
  expires_at?: string;
}

export interface ExtractionMetadata {
  title: string;
  description: string;
  author: string;
  duration?: number;
  published_at?: string;
  platform_id?: string;
  tags?: string[];
}

export interface EmailNotifyConfig {
  enabled: boolean;
  email: string;
}
