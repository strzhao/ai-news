import { parseBearerToken } from "@/lib/domain/tracker-common";

export function articleDbAuthEnabled(): boolean {
  return Boolean(String(process.env.ARTICLE_DB_API_TOKEN || "").trim());
}

export function isArticleDbAuthorized(request: Request): boolean {
  const expected = String(process.env.ARTICLE_DB_API_TOKEN || "").trim();
  if (!expected) {
    return true;
  }
  const provided = parseBearerToken(request.headers.get("authorization"));
  return provided === expected;
}

export function requireArticleDbAuth(request: Request): string {
  if (isArticleDbAuthorized(request)) {
    return "";
  }
  return "Unauthorized";
}
