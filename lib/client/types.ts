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
