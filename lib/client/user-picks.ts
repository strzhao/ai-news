export interface UserPickItem {
  article_id: string;
  title: string;
  url: string;
  original_url: string;
  source_host: string;
  image_url: string;
  summary: string;
  ai_summary?: string;
  saved_at: string;
}

export interface UserPickPayload {
  article_id: string;
  title: string;
  url: string;
  original_url: string;
  source_host: string;
  image_url: string;
  summary: string;
  ai_summary?: string;
}

export async function saveUserPick(payload: UserPickPayload): Promise<{ ok: boolean }> {
  const response = await fetch("/api/v1/user-picks", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(payload),
  });
  const data = (await response.json()) as { ok: boolean };
  return data;
}

export async function fetchUserPicks(): Promise<UserPickItem[]> {
  try {
    const response = await fetch("/api/v1/user-picks", {
      cache: "no-store",
      credentials: "include",
    });
    if (!response.ok) return [];
    const data = (await response.json()) as { ok: boolean; items?: UserPickItem[] };
    return data.ok && Array.isArray(data.items) ? data.items : [];
  } catch {
    return [];
  }
}
