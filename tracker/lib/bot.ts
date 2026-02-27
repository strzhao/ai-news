const BOT_UA_TOKENS = [
  "bot",
  "spider",
  "crawler",
  "preview",
  "slackbot",
  "discordbot",
  "telegrambot",
  "facebookexternalhit",
  "curl",
];

export function shouldSkipTracking(method: string | undefined, userAgent: string | undefined): boolean {
  if ((method || "").toUpperCase() === "HEAD") {
    return true;
  }
  const ua = (userAgent || "").toLowerCase();
  if (!ua) {
    return false;
  }
  return BOT_UA_TOKENS.some((token) => ua.includes(token));
}

