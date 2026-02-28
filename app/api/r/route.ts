import { NextResponse } from "next/server";
import {
  buildUpstashClientOrNone,
  hashInfoKey,
  normalizeUrl,
  queryValue,
  shouldSkipTracking,
  utcDateKey,
  verifySignature,
} from "@/lib/domain/tracker-common";
import { buildSignedTrackingUrl } from "@/lib/tracking/signed-url";

export const runtime = "nodejs";

function signedParams(url: string): Record<string, string> {
  return {
    u: queryValue(url, "u"),
    sid: queryValue(url, "sid"),
    aid: queryValue(url, "aid"),
    d: queryValue(url, "d"),
    ch: queryValue(url, "ch"),
    pt: queryValue(url, "pt"),
  };
}

function acceptsHtml(acceptHeader: string | null): boolean {
  const value = String(acceptHeader || "").toLowerCase();
  if (!value) return false;
  return value.includes("text/html") || value.includes("application/xhtml+xml");
}

function htmlEscape(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function buildRedirectPageHtml(params: Record<string, string>): string {
  const targetUrl = params.u;
  const targetHost = (() => {
    try {
      return new URL(targetUrl).host || targetUrl;
    } catch {
      return targetUrl || "-";
    }
  })();
  const sourceId = String(params.sid || "-").trim() || "-";
  const primaryType = String(params.pt || "other").trim() || "other";
  const channel = String(params.ch || "-").trim() || "-";
  const date = String(params.d || "-").trim() || "-";
  const scriptTarget = JSON.stringify(targetUrl);

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex,nofollow,noarchive">
  <meta http-equiv="refresh" content="2;url=${htmlEscape(targetUrl)}">
  <title>正在跳转到原文</title>
  <style>
    :root { --bg: #f5f7fb; --card: #ffffff; --text: #111827; --muted: #4b5563; --line: #dbe1ea; --btn: #1f6feb; --btn-hover: #1559bf; }
    * { box-sizing: border-box; }
    body { margin: 0; padding: 24px; min-height: 100vh; display: grid; place-items: center; background: radial-gradient(circle at 10% -10%, #e5edff 0, var(--bg) 36%); color: var(--text); font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif; }
    .card { width: min(560px, 100%); background: var(--card); border: 1px solid var(--line); border-radius: 14px; padding: 20px 20px 16px; box-shadow: 0 8px 24px rgba(17, 24, 39, 0.06); }
    h1 { margin: 0 0 8px; font-size: 18px; line-height: 1.4; }
    p { margin: 0 0 14px; color: var(--muted); font-size: 14px; line-height: 1.6; }
    dl { margin: 0; display: grid; grid-template-columns: 92px 1fr; gap: 8px 10px; font-size: 13px; line-height: 1.5; }
    dt { color: var(--muted); }
    dd { margin: 0; word-break: break-all; }
    .footer { margin-top: 14px; display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
    .btn { text-decoration: none; background: var(--btn); color: #fff; border-radius: 8px; padding: 8px 12px; font-size: 13px; }
    .btn:hover { background: var(--btn-hover); }
    .countdown { color: var(--muted); font-size: 13px; }
  </style>
</head>
<body>
  <main class="card">
    <h1>正在跳转到原文</h1>
    <p>链接已记录为阅读行为，页面将在 <span id="countdown">2.0</span> 秒后自动打开。</p>
    <dl>
      <dt>目标站点</dt><dd>${htmlEscape(targetHost)}</dd>
      <dt>消息源</dt><dd>${htmlEscape(sourceId)}</dd>
      <dt>文章类型</dt><dd>${htmlEscape(primaryType)}</dd>
      <dt>渠道</dt><dd>${htmlEscape(channel)}</dd>
      <dt>日报日期</dt><dd>${htmlEscape(date)}</dd>
    </dl>
    <div class="footer">
      <a class="btn" href="${htmlEscape(targetUrl)}" rel="noopener noreferrer">立即打开原文</a>
      <span class="countdown">若未自动跳转，请点击按钮。</span>
    </div>
  </main>
  <script>
    (function () {
      var target = ${scriptTarget};
      var countdown = document.getElementById("countdown");
      var started = Date.now();
      var delayMs = 2000;
      function tick() {
        var left = Math.max(0, delayMs - (Date.now() - started));
        countdown.textContent = (left / 1000).toFixed(1);
      }
      var timer = setInterval(tick, 100);
      setTimeout(function () {
        clearInterval(timer);
        window.location.replace(target);
      }, delayMs);
      tick();
    })();
  </script>
</body>
</html>`;
}

async function trackClick(params: Record<string, string>): Promise<void> {
  const upstash = buildUpstashClientOrNone();
  if (!upstash) {
    return;
  }

  const dateKey = utcDateKey();
  const sourceKey = `clicks:source:${dateKey}`;
  const articleKey = `clicks:article:${dateKey}`;
  const metaKey = `clicks:meta:${dateKey}`;
  const articleInfoKey = hashInfoKey(normalizeUrl(params.u));

  await upstash.hincrby(sourceKey, params.sid, 1);
  await upstash.expire(sourceKey);
  await upstash.hincrby(articleKey, articleInfoKey, 1);
  await upstash.expire(articleKey);
  await upstash.hincrby(metaKey, "total", 1);
  await upstash.expire(metaKey);

  const primaryType = String(params.pt || "").trim();
  if (primaryType) {
    const typeKey = `clicks:type:${dateKey}`;
    await upstash.hincrby(typeKey, primaryType, 1);
    await upstash.expire(typeKey);
  }
}

export async function GET(request: Request): Promise<Response> {
  const secret = String(process.env.TRACKER_SIGNING_SECRET || "").trim();
  if (!secret) {
    return NextResponse.json({ error: "Missing TRACKER_SIGNING_SECRET" }, { status: 500 });
  }

  const params = signedParams(request.url);
  const signature = queryValue(request.url, "sig");
  const requiredKeys = ["u", "sid", "aid", "d", "ch"];
  if (requiredKeys.some((key) => !String(params[key] || "").trim())) {
    return NextResponse.json({ error: "Missing required query params" }, { status: 400 });
  }

  try {
    if (!params.u.trim()) {
      throw new Error("empty");
    }
    const normalized = normalizeUrl(params.u);
    if (!normalized.startsWith("http://") && !normalized.startsWith("https://")) {
      throw new Error("invalid");
    }
  } catch {
    return NextResponse.json({ error: "Invalid target URL" }, { status: 400 });
  }

  const legacyParams = {
    u: params.u,
    sid: params.sid,
    aid: params.aid,
    d: params.d,
    ch: params.ch,
  };

  if (!verifySignature(params, signature, secret) && !verifySignature(legacyParams, signature, secret)) {
    const upstash = buildUpstashClientOrNone();
    if (upstash) {
      try {
        const metaKey = `clicks:meta:${utcDateKey()}`;
        await upstash.hincrby(metaKey, "invalid_sig", 1);
        await upstash.expire(metaKey);
      } catch {
        // ignore
      }
    }
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  if (shouldSkipTracking(request.method, request.headers.get("user-agent"))) {
    return NextResponse.redirect(params.u, 302);
  }

  try {
    await trackClick(params);
  } catch {
    // tracking errors should not block redirect
  }

  if (acceptsHtml(request.headers.get("accept"))) {
    const body = buildRedirectPageHtml(params);
    return new NextResponse(body, {
      status: 200,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store, max-age=0",
      },
    });
  }

  return NextResponse.redirect(params.u, 302);
}
