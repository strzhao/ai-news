import type {
  ExtractedResource,
  ExtractionMetadata,
  ExtractionPlatform,
  ExtractionStatus,
} from "./types";

export interface ExtractionTaskResponse {
  task_id: string;
  url: string;
  platform: ExtractionPlatform;
  status: ExtractionStatus;
  resources: ExtractedResource[];
  metadata: ExtractionMetadata;
  created_at: string;
  completed_at?: string;
  error_message?: string;
  blob_ttl_hours: number;
  ai_summary?: string;
}

interface SubmitResult {
  ok: boolean;
  task?: ExtractionTaskResponse;
  error?: string;
}

export async function submitExtraction(
  url: string,
  aiSummary?: boolean,
): Promise<SubmitResult> {
  const response = await fetch("/api/v1/analyze-url", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ url, ai_summary: aiSummary || false }),
  });
  const payload = (await response.json()) as SubmitResult;
  return payload;
}

export async function pollTaskStatus(taskId: string): Promise<SubmitResult> {
  const response = await fetch(
    `/api/v1/analyze-url?task_id=${encodeURIComponent(taskId)}`,
    {
      method: "GET",
      credentials: "include",
    },
  );
  const payload = (await response.json()) as SubmitResult;
  return payload;
}

interface TaskListResult {
  ok: boolean;
  tasks: ExtractionTaskResponse[];
  error?: string;
}

export async function fetchTaskList(): Promise<TaskListResult> {
  const response = await fetch("/api/v1/analyze-url/tasks", {
    method: "GET",
    credentials: "include",
  });
  const payload = (await response.json()) as TaskListResult;
  if (!payload.tasks) payload.tasks = [];
  return payload;
}
