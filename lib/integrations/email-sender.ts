/**
 * Email notification for extraction completion.
 *
 * Requires:
 *   npm install resend
 *   RESEND_API_KEY env var
 *   RESEND_FROM_EMAIL env var (verified domain sender)
 */

interface ExtractionEmailPayload {
  title: string;
  url: string;
  platform: string;
  resourceCount: number;
  blobTtlHours: number;
  analyzPageUrl: string;
}

export async function sendExtractionCompleteEmail(
  to: string,
  payload: ExtractionEmailPayload,
): Promise<{ ok: boolean; error?: string }> {
  const apiKey = String(process.env.RESEND_API_KEY || "").trim();
  const fromEmail = String(process.env.RESEND_FROM_EMAIL || "").trim();

  if (!apiKey || !fromEmail) {
    return { ok: false, error: "email_not_configured" };
  }

  try {
    // Use Resend REST API directly (avoids needing the SDK installed at compile time)
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: fromEmail,
        to: [to],
        subject: `URL 资源提取完成: ${payload.title || payload.url}`,
        html: buildEmailHtml(payload),
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      return { ok: false, error: `resend_error_${response.status}: ${text}` };
    }

    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

function buildEmailHtml(payload: ExtractionEmailPayload): string {
  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; color: #333;">
  <h2 style="color: #2a7a5a; margin-bottom: 4px;">URL 资源提取完成</h2>
  <p style="color: #888; font-size: 13px; margin-top: 0;">来自 AI News</p>

  <div style="background: #f8f9fa; border-radius: 12px; padding: 16px; margin: 16px 0;">
    <p style="margin: 0 0 8px; font-size: 14px; color: #666;">平台: <strong>${escapeHtml(payload.platform)}</strong></p>
    <p style="margin: 0 0 8px; font-size: 16px; font-weight: 600;">${escapeHtml(payload.title || "无标题")}</p>
    <p style="margin: 0; font-size: 13px; color: #666; word-break: break-all;">${escapeHtml(payload.url)}</p>
  </div>

  <p style="font-size: 14px;">
    共提取 <strong>${payload.resourceCount}</strong> 个资源，
    有效期 <strong>${payload.blobTtlHours}</strong> 小时。
  </p>

  <a href="${escapeHtml(payload.analyzPageUrl)}"
     style="display: inline-block; padding: 10px 20px; background: #2a7a5a; color: white; text-decoration: none; border-radius: 8px; font-size: 14px; font-weight: 600;">
    查看提取结果
  </a>

  <p style="color: #aaa; font-size: 12px; margin-top: 24px;">
    此邮件由 AI News 自动发送。如不想接收，请在设置页关闭邮件通知。
  </p>
</body>
</html>`.trim();
}

function escapeHtml(text: string): string {
  return String(text || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
