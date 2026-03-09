import type {
  ExtractionPlatform,
  ExtractionStatus,
  ExtractedResource,
  ExtractionMetadata,
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
}

interface SubmitResult {
  ok: boolean;
  task?: ExtractionTaskResponse;
  error?: string;
}

export async function submitExtraction(url: string): Promise<SubmitResult> {
  const response = await fetch("/api/v1/analyze-url", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ url }),
  });
  const payload = (await response.json()) as SubmitResult;
  return payload;
}

export async function pollTaskStatus(taskId: string): Promise<SubmitResult> {
  const response = await fetch(`/api/v1/analyze-url?task_id=${encodeURIComponent(taskId)}`, {
    method: "GET",
    credentials: "include",
  });
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
