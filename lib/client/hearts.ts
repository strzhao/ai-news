export async function fetchHeartedIds(): Promise<string[]> {
  try {
    const response = await fetch("/api/v1/hearts/ids", {
      cache: "no-store",
      credentials: "include",
    });
    if (!response.ok) return [];
    const data = (await response.json()) as { ok: boolean; ids?: string[] };
    return data.ok && Array.isArray(data.ids) ? data.ids : [];
  } catch {
    return [];
  }
}

export async function toggleHeart(article: {
  article_id: string;
  title: string;
  url: string;
  original_url?: string;
  source_host: string;
  image_url?: string;
  summary?: string;
}): Promise<{ ok: boolean; hearted: boolean }> {
  const response = await fetch("/api/v1/hearts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({
      article_id: article.article_id,
      title: article.title,
      url: article.url,
      original_url: article.original_url || "",
      source_host: article.source_host,
      image_url: article.image_url || "",
      summary: article.summary || "",
    }),
  });
  const data = (await response.json()) as { ok: boolean; hearted: boolean };
  return data;
}
