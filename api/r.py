from __future__ import annotations

import html
import json
import os
from http.server import BaseHTTPRequestHandler
from urllib.parse import urlparse

from api._tracker_common import (
    build_upstash_client_or_none,
    hash_info_key,
    normalize_url,
    query_value,
    should_skip_tracking,
    utc_date_key,
    verify_signature,
)


def _signed_params(request: BaseHTTPRequestHandler) -> dict[str, str]:
    return {
        "u": query_value(request.path, "u"),
        "sid": query_value(request.path, "sid"),
        "aid": query_value(request.path, "aid"),
        "d": query_value(request.path, "d"),
        "ch": query_value(request.path, "ch"),
        "pt": query_value(request.path, "pt"),
    }


def _respond_json(request: BaseHTTPRequestHandler, status: int, payload: dict[str, object]) -> None:
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    request.send_response(status)
    request.send_header("Content-Type", "application/json; charset=utf-8")
    request.send_header("Content-Length", str(len(body)))
    request.end_headers()
    request.wfile.write(body)


def _redirect(request: BaseHTTPRequestHandler, target_url: str) -> None:
    request.send_response(302)
    request.send_header("Location", target_url)
    request.end_headers()


def _accepts_html(accept_header: str | None) -> bool:
    value = str(accept_header or "").lower()
    if not value:
        return False
    return "text/html" in value or "application/xhtml+xml" in value


def _build_redirect_page_html(params: dict[str, str]) -> str:
    target_url = params["u"]
    target_host = str(urlparse(target_url).netloc or target_url).strip() or "-"
    source_id = str(params.get("sid") or "-").strip() or "-"
    primary_type = str(params.get("pt") or "other").strip() or "other"
    channel = str(params.get("ch") or "-").strip() or "-"
    date = str(params.get("d") or "-").strip() or "-"
    script_target = json.dumps(target_url, ensure_ascii=False)

    return f"""<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex,nofollow,noarchive">
  <meta http-equiv="refresh" content="2;url={html.escape(target_url, quote=True)}">
  <title>正在跳转到原文</title>
  <style>
    :root {{
      --bg: #f5f7fb;
      --card: #ffffff;
      --text: #111827;
      --muted: #4b5563;
      --line: #dbe1ea;
      --btn: #1f6feb;
      --btn-hover: #1559bf;
    }}
    * {{ box-sizing: border-box; }}
    body {{
      margin: 0;
      padding: 24px;
      min-height: 100vh;
      display: grid;
      place-items: center;
      background: radial-gradient(circle at 10% -10%, #e5edff 0, var(--bg) 36%);
      color: var(--text);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
    }}
    .card {{
      width: min(560px, 100%);
      background: var(--card);
      border: 1px solid var(--line);
      border-radius: 14px;
      padding: 20px 20px 16px;
      box-shadow: 0 8px 24px rgba(17, 24, 39, 0.06);
    }}
    h1 {{
      margin: 0 0 8px;
      font-size: 18px;
      line-height: 1.4;
    }}
    p {{
      margin: 0 0 14px;
      color: var(--muted);
      font-size: 14px;
      line-height: 1.6;
    }}
    dl {{
      margin: 0;
      display: grid;
      grid-template-columns: 92px 1fr;
      gap: 8px 10px;
      font-size: 13px;
      line-height: 1.5;
    }}
    dt {{ color: var(--muted); }}
    dd {{
      margin: 0;
      word-break: break-all;
    }}
    .footer {{
      margin-top: 14px;
      display: flex;
      align-items: center;
      gap: 10px;
      flex-wrap: wrap;
    }}
    .btn {{
      text-decoration: none;
      background: var(--btn);
      color: #fff;
      border-radius: 8px;
      padding: 8px 12px;
      font-size: 13px;
    }}
    .btn:hover {{ background: var(--btn-hover); }}
    .countdown {{
      color: var(--muted);
      font-size: 13px;
    }}
  </style>
</head>
<body>
  <main class="card">
    <h1>正在跳转到原文</h1>
    <p>链接已记录为阅读行为，页面将在 <span id="countdown">2.0</span> 秒后自动打开。</p>
    <dl>
      <dt>目标站点</dt><dd>{html.escape(target_host)}</dd>
      <dt>消息源</dt><dd>{html.escape(source_id)}</dd>
      <dt>文章类型</dt><dd>{html.escape(primary_type)}</dd>
      <dt>渠道</dt><dd>{html.escape(channel)}</dd>
      <dt>日报日期</dt><dd>{html.escape(date)}</dd>
    </dl>
    <div class="footer">
      <a class="btn" href="{html.escape(target_url, quote=True)}" rel="noopener noreferrer">立即打开原文</a>
      <span class="countdown">若未自动跳转，请点击按钮。</span>
    </div>
  </main>
  <script>
    (function () {{
      var target = {script_target};
      var countdown = document.getElementById("countdown");
      var started = Date.now();
      var delayMs = 2000;
      function tick() {{
        var left = Math.max(0, delayMs - (Date.now() - started));
        countdown.textContent = (left / 1000).toFixed(1);
      }}
      var timer = setInterval(tick, 100);
      setTimeout(function () {{
        clearInterval(timer);
        window.location.replace(target);
      }}, delayMs);
      tick();
    }})();
  </script>
</body>
</html>
"""


def _render_redirect_page(request: BaseHTTPRequestHandler, params: dict[str, str]) -> None:
    html_body = _build_redirect_page_html(params).encode("utf-8")
    request.send_response(200)
    request.send_header("Content-Type", "text/html; charset=utf-8")
    request.send_header("Cache-Control", "no-store, max-age=0")
    request.send_header("Content-Length", str(len(html_body)))
    request.end_headers()
    request.wfile.write(html_body)


def _track_click(params: dict[str, str], user_agent: str | None) -> None:
    upstash = build_upstash_client_or_none()
    if not upstash:
        return

    date_key = utc_date_key()
    source_key = f"clicks:source:{date_key}"
    article_key = f"clicks:article:{date_key}"
    meta_key = f"clicks:meta:{date_key}"
    article_info_key = hash_info_key(normalize_url(params["u"]))

    upstash.hincrby(source_key, params["sid"], 1)
    upstash.expire(source_key)
    upstash.hincrby(article_key, article_info_key, 1)
    upstash.expire(article_key)
    upstash.hincrby(meta_key, "total", 1)
    upstash.expire(meta_key)

    primary_type = str(params.get("pt") or "").strip()
    if primary_type:
        type_key = f"clicks:type:{date_key}"
        upstash.hincrby(type_key, primary_type, 1)
        upstash.expire(type_key)


class handler(BaseHTTPRequestHandler):
    def do_GET(self) -> None:  # noqa: N802
        secret = str(os.getenv("TRACKER_SIGNING_SECRET") or "").strip()
        if not secret:
            _respond_json(self, 500, {"error": "Missing TRACKER_SIGNING_SECRET"})
            return

        params = _signed_params(self)
        signature = query_value(self.path, "sig")
        required_keys = ("u", "sid", "aid", "d", "ch")
        if any(not str(params[key]).strip() for key in required_keys):
            _respond_json(self, 400, {"error": "Missing required query params"})
            return

        try:
            # Validate URL early to avoid open redirect abuse.
            if not params["u"].strip():
                raise ValueError("empty")
            parsed = normalize_url(params["u"])
            if not parsed.startswith("http://") and not parsed.startswith("https://"):
                raise ValueError("invalid")
        except Exception:
            _respond_json(self, 400, {"error": "Invalid target URL"})
            return

        legacy_params = {
            "u": params["u"],
            "sid": params["sid"],
            "aid": params["aid"],
            "d": params["d"],
            "ch": params["ch"],
        }
        if not verify_signature(params, signature, secret) and not verify_signature(legacy_params, signature, secret):
            upstash = build_upstash_client_or_none()
            if upstash:
                try:
                    meta_key = f"clicks:meta:{utc_date_key()}"
                    upstash.hincrby(meta_key, "invalid_sig", 1)
                    upstash.expire(meta_key)
                except Exception:
                    pass
            _respond_json(self, 400, {"error": "Invalid signature"})
            return

        user_agent = str(self.headers.get("user-agent") or "")
        if should_skip_tracking("GET", user_agent):
            _redirect(self, params["u"])
            return

        try:
            _track_click(params, user_agent)
        except Exception:
            # Tracking failures should never block redirect.
            pass

        if _accepts_html(self.headers.get("accept")):
            _render_redirect_page(self, params)
            return

        _redirect(self, params["u"])
