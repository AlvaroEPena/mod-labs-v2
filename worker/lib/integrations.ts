import type { Attachment, RenderedEmail } from "./email";

export const TURNSTILE_VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
export const RESEND_URL = "https://api.resend.com/emails";
const TIMEOUT_MS = 10_000;

export type TurnstileResult = "ok" | "failed" | "unavailable";

/** Server-side Turnstile token verification (https://developers.cloudflare.com/turnstile/get-started/server-side-validation/). */
export async function verifyTurnstile(secret: string, token: string, remoteIp: string | null): Promise<TurnstileResult> {
  if (!token || token.length > 2048) return "failed";
  const body = new FormData();
  body.append("secret", secret);
  body.append("response", token);
  if (remoteIp) body.append("remoteip", remoteIp);
  try {
    const res = await fetch(TURNSTILE_VERIFY_URL, { method: "POST", body, signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) {
      console.error("turnstile siteverify http error", res.status);
      return "unavailable";
    }
    const data = (await res.json()) as { success?: boolean; "error-codes"?: string[] };
    if (data.success === true) return "ok";
    console.warn("turnstile rejected", data["error-codes"] ?? []);
    return "failed";
  } catch (err) {
    console.error("turnstile siteverify request failed", err instanceof Error ? err.name : "unknown");
    return "unavailable";
  }
}

export interface SendArgs {
  apiKey: string;
  from: string;
  to: string;
  email: RenderedEmail;
  attachments: Attachment[];
}

/** Send via Resend REST API (https://resend.com/docs/api-reference/emails/send-email). Returns true on 2xx. */
export async function sendViaResend({ apiKey, from, to, email, attachments }: SendArgs): Promise<boolean> {
  const payload: Record<string, unknown> = {
    from,
    to: [to],
    reply_to: email.replyTo,
    subject: email.subject,
    html: email.html,
    text: email.text,
  };
  if (attachments.length > 0) payload.attachments = attachments;
  try {
    const res = await fetch(RESEND_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) {
      console.error("resend send failed", res.status);
      return false;
    }
    return true;
  } catch (err) {
    console.error("resend request failed", err instanceof Error ? err.name : "unknown");
    return false;
  }
}
