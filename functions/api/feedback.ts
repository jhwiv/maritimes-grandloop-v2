/**
 * POST /api/feedback
 *
 * Cloudflare Pages Function. Receives traveler feedback from the in-app
 * floating button and forwards it to ChipWilkes@gmail.com via SendGrid.
 *
 * Pattern adapted from vigil-family-advisor/server/email.ts.
 *
 * Required secrets (set with `wrangler pages secret put …`):
 *   SENDGRID_API_KEY        SendGrid API key with Mail Send permission.
 *
 * Optional vars / secrets:
 *   FEEDBACK_TO             Recipient. Defaults to ChipWilkes@gmail.com.
 *   SENDGRID_FROM_EMAIL     Verified sender. Defaults to no-reply@maritimesgrandloop.com.
 *   SENDGRID_FROM_NAME      Display name. Defaults to "Maritimes Grand Loop".
 *
 * Dev mode: when SENDGRID_API_KEY is unset, the function logs the message
 * and responds 200 — same behavior as Vigil's server/email.ts.
 */

interface Env {
  SENDGRID_API_KEY?: string;
  SENDGRID_FROM_EMAIL?: string;
  SENDGRID_FROM_NAME?: string;
  FEEDBACK_TO?: string;
}

type FeedbackContext = {
  app?: string;
  url?: string;
  path?: string;
  section?: string;
  userAgent?: string;
  language?: string;
  viewport?: string;
  timezone?: string;
  timestamp?: string;
};

type FeedbackBody = {
  category?: string;
  message?: string;
  context?: FeedbackContext;
};

const DEFAULT_RECIPIENT = "ChipWilkes@gmail.com";
const DEFAULT_FROM_EMAIL = "no-reply@maritimesgrandloop.com";
const DEFAULT_FROM_NAME = "Maritimes Grand Loop";
const SENDGRID_URL = "https://api.sendgrid.com/v3/mail/send";

const ALLOWED_CATEGORIES = new Set([
  "problem",
  "question",
  "suggestion",
  "content",
  "other",
]);

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function clip(s: unknown, max: number): string {
  const v = typeof s === "string" ? s : "";
  return v.length > max ? v.slice(0, max) : v;
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  let body: FeedbackBody;
  try {
    body = (await request.json()) as FeedbackBody;
  } catch {
    return jsonResponse(400, { ok: false, error: "invalid JSON" });
  }

  const message = clip(body?.message, 4000).trim();
  if (message.length < 3) {
    return jsonResponse(400, { ok: false, error: "message too short" });
  }

  const rawCategory = clip(body?.category, 32).toLowerCase();
  const category = ALLOWED_CATEGORIES.has(rawCategory) ? rawCategory : "other";

  const ctx: FeedbackContext = body?.context ?? {};
  const safeCtx = {
    app: clip(ctx.app, 80) || "Maritimes Grand Loop",
    url: clip(ctx.url, 500),
    path: clip(ctx.path, 300),
    section: clip(ctx.section, 80),
    userAgent: clip(ctx.userAgent, 400),
    language: clip(ctx.language, 32),
    viewport: clip(ctx.viewport, 32),
    timezone: clip(ctx.timezone, 64),
    timestamp: clip(ctx.timestamp, 40) || new Date().toISOString(),
  };

  const cfIp =
    request.headers.get("CF-Connecting-IP") ||
    request.headers.get("X-Forwarded-For") ||
    "";
  const referrer = request.headers.get("referer") || "";

  const recipient = (env.FEEDBACK_TO || DEFAULT_RECIPIENT).trim();
  const fromEmail = (env.SENDGRID_FROM_EMAIL || DEFAULT_FROM_EMAIL).trim();
  const fromName = (env.SENDGRID_FROM_NAME || DEFAULT_FROM_NAME).trim();

  const subject = `[Maritimes feedback · ${category}] ${message.slice(0, 60)}${message.length > 60 ? "…" : ""}`;

  const textLines = [
    `Category: ${category}`,
    `When:     ${safeCtx.timestamp}`,
    "",
    "Message",
    "-------",
    message,
    "",
    "Context",
    "-------",
    `App:        ${safeCtx.app}`,
    `URL:        ${safeCtx.url}`,
    `Path:       ${safeCtx.path}`,
    `Section:    ${safeCtx.section || "(unknown)"}`,
    `Timezone:   ${safeCtx.timezone}`,
    `Viewport:   ${safeCtx.viewport}`,
    `Language:   ${safeCtx.language}`,
    `User agent: ${safeCtx.userAgent}`,
    `Referrer:   ${referrer}`,
    `Client IP:  ${cfIp}`,
  ];
  const text = textLines.join("\n");

  const html = `
<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:640px;color:#1b2838;">
  <h2 style="font-family:Georgia,serif;color:#111d2b;margin:0 0 4px;">Maritimes Grand Loop · feedback</h2>
  <p style="margin:0 0 16px;color:#5a6675;font-size:13px;">
    <strong>Category:</strong> ${escapeHtml(category)} &middot;
    <strong>${escapeHtml(safeCtx.timestamp)}</strong>
  </p>
  <div style="white-space:pre-wrap;background:#faf7f2;border:1px solid #e6dfd1;border-radius:8px;padding:14px 16px;font-size:15px;line-height:1.5;">
    ${escapeHtml(message)}
  </div>
  <h3 style="font-family:Georgia,serif;color:#111d2b;margin:22px 0 6px;font-size:14px;">Context</h3>
  <table style="font-size:12px;color:#5a6675;border-collapse:collapse;">
    <tr><td style="padding:2px 12px 2px 0;"><strong>App</strong></td><td>${escapeHtml(safeCtx.app)}</td></tr>
    <tr><td style="padding:2px 12px 2px 0;"><strong>URL</strong></td><td>${escapeHtml(safeCtx.url)}</td></tr>
    <tr><td style="padding:2px 12px 2px 0;"><strong>Section</strong></td><td>${escapeHtml(safeCtx.section || "(unknown)")}</td></tr>
    <tr><td style="padding:2px 12px 2px 0;"><strong>Timezone</strong></td><td>${escapeHtml(safeCtx.timezone)}</td></tr>
    <tr><td style="padding:2px 12px 2px 0;"><strong>Viewport</strong></td><td>${escapeHtml(safeCtx.viewport)}</td></tr>
    <tr><td style="padding:2px 12px 2px 0;"><strong>Language</strong></td><td>${escapeHtml(safeCtx.language)}</td></tr>
    <tr><td style="padding:2px 12px 2px 0;vertical-align:top;"><strong>User agent</strong></td><td>${escapeHtml(safeCtx.userAgent)}</td></tr>
    <tr><td style="padding:2px 12px 2px 0;"><strong>Referrer</strong></td><td>${escapeHtml(referrer)}</td></tr>
    <tr><td style="padding:2px 12px 2px 0;"><strong>Client IP</strong></td><td>${escapeHtml(cfIp)}</td></tr>
  </table>
</div>`.trim();

  const apiKey = env.SENDGRID_API_KEY;
  if (!apiKey) {
    console.log(`[feedback:dev] to=${recipient} subject="${subject}"`);
    console.log(`[feedback:dev] body=\n${text}`);
    return jsonResponse(200, { ok: true, dev: true });
  }

  const sgBody = {
    personalizations: [{ to: [{ email: recipient }] }],
    from: { email: fromEmail, name: fromName },
    reply_to: { email: fromEmail, name: fromName },
    subject,
    content: [
      { type: "text/plain", value: text },
      { type: "text/html", value: html },
    ],
  };

  try {
    const res = await fetch(SENDGRID_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(sgBody),
    });
    if (!res.ok) {
      const errText = await res.text();
      console.error(`[feedback] SendGrid ${res.status}: ${errText}`);
      return jsonResponse(502, { ok: false, error: `email provider ${res.status}` });
    }
    return jsonResponse(200, { ok: true });
  } catch (err: unknown) {
    const msgErr = err instanceof Error ? err.message : String(err);
    console.error(`[feedback] network error: ${msgErr}`);
    return jsonResponse(502, { ok: false, error: "network error" });
  }
};

export const onRequest: PagesFunction<Env> = async ({ request }) => {
  if (request.method === "POST") {
    // Should not reach here — onRequestPost handles POST. Defensive fallback.
    return jsonResponse(405, { ok: false, error: "method not allowed" });
  }
  return jsonResponse(405, { ok: false, error: "method not allowed" });
};
