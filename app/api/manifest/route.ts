import { NextResponse } from "next/server";

const manifest = {
  version: "1",
  base_url: "https://ai-news.stringzhao.life",
  auth: {
    type: "bearer",
    authorize_url: "https://user.stringzhao.life/authorize",
    service_id: "base-account-client",
    cli_auth_path: "/auth/cli",
  },
  operations: [
    {
      id: "list_articles",
      name: "articles:list",
      description: "List archived articles with optional filters",
      method: "GET",
      path: "/api/archive_articles",
      params: [
        {
          name: "days",
          in: "query",
          type: "number",
          required: false,
          description: "Number of days to fetch (1-180, default 30)",
        },
        {
          name: "limit_per_day",
          in: "query",
          type: "number",
          required: false,
          description: "Max articles per day (1-200, default 10)",
        },
        {
          name: "quality_tier",
          in: "query",
          type: "string",
          enum: ["high", "general", "all"],
          required: false,
          description: "Quality filter [high|general|all]",
        },
      ],
    },
    {
      id: "get_article_summary",
      name: "articles:summary",
      description: "Get AI-generated summary for an article",
      method: "GET",
      path: "/api/article_summary/:article_id",
      params: [
        {
          name: "article_id",
          in: "path",
          type: "string",
          required: true,
          description: "Article ID",
        },
      ],
    },
    {
      id: "analyze_url",
      name: "url:analyze",
      description: "Submit a URL for content extraction and analysis",
      method: "POST",
      path: "/api/v1/analyze-url",
      params: [
        {
          name: "url",
          in: "body",
          type: "string",
          required: true,
          description: "URL to analyze",
        },
      ],
    },
    {
      id: "analyze_url_status",
      name: "url:status",
      description: "Check status of a URL analysis task",
      method: "GET",
      path: "/api/v1/analyze-url",
      params: [
        {
          name: "task_id",
          in: "query",
          type: "string",
          required: true,
          description: "Task ID to check",
        },
      ],
    },
    {
      id: "list_analyze_tasks",
      name: "url:tasks",
      description: "List your URL analysis tasks",
      method: "GET",
      path: "/api/v1/analyze-url/tasks",
      params: [],
    },
    {
      id: "get_flomo_config",
      name: "flomo:config",
      description: "Get your Flomo webhook configuration",
      method: "GET",
      path: "/api/v1/flomo/config",
      params: [],
    },
    {
      id: "set_flomo_config",
      name: "flomo:set-webhook",
      description: "Set your Flomo webhook URL",
      method: "POST",
      path: "/api/v1/flomo/config",
      params: [
        {
          name: "webhook_url",
          in: "body",
          type: "string",
          required: true,
          description: "Flomo webhook URL (must be HTTPS)",
        },
      ],
    },
    {
      id: "flomo_push_log",
      name: "flomo:push-log",
      description: "View Flomo push history",
      method: "GET",
      path: "/api/v1/flomo/push-log",
      params: [
        {
          name: "limit",
          in: "query",
          type: "number",
          required: false,
          description: "Number of entries (1-50, default 20)",
        },
      ],
    },
    {
      id: "flomo_click_stats",
      name: "flomo:click-stats",
      description: "View Flomo article click statistics",
      method: "GET",
      path: "/api/v1/flomo/click-stats",
      params: [
        {
          name: "days",
          in: "query",
          type: "number",
          required: false,
          description: "Number of days (1-120, default 30)",
        },
      ],
    },
    {
      id: "stats_sources",
      name: "stats:sources",
      description: "View click statistics by news source",
      method: "GET",
      path: "/api/stats/sources",
      params: [
        {
          name: "days",
          in: "query",
          type: "number",
          required: false,
          description: "Number of days (1-120, default 90)",
        },
      ],
    },
    {
      id: "stats_types",
      name: "stats:types",
      description: "View click statistics by article type",
      method: "GET",
      path: "/api/stats/types",
      params: [
        {
          name: "days",
          in: "query",
          type: "number",
          required: false,
          description: "Number of days (1-120, default 90)",
        },
      ],
    },
  ],
};

export async function GET() {
  return NextResponse.json(manifest, {
    headers: { "Cache-Control": "public, max-age=300" },
  });
}
