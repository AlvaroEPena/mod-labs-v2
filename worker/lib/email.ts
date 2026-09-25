import { escapeHtml, safeFilename, singleLine } from "./escape";
import type { Photo, Submission } from "./validate";

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
  replyTo: string;
}

export interface Attachment {
  filename: string;
  content: string; // base64
  content_type: string;
}

const EXT: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

/** Short label for the subject: drop the "($160)" price suffix and "Custom build commission:" prefix. */
function shortLabel(value: string): string {
  return value
    .replace(/\s*\(\$\d+\)\s*$/, "")
    .replace(/^Custom build commission:\s*(.+)$/, "$1 commission");
}

export function buildSubject(s: Submission): string {
  const name = s.data.name;
  if (s.kind === "book") {
    const [first, ...rest] = s.data.services;
    const what = `${shortLabel(first ?? "service")}${rest.length > 0 ? ` +${rest.length} more` : ""}`;
    return singleLine(`New booking: ${what} — ${name}`);
  }
  return singleLine(`New quote: ${shortLabel(s.data.requestType)} — ${name}`);
}

function rows(s: Submission, photos: Photo[]): [string, string][] {
  const d = s.data;
  const out: [string, string][] = [];
  if (s.kind === "book") out.push(["Services", s.data.services.join("\n")]);
  else out.push(["Request type", s.data.requestType]);
  out.push(["Name", d.name], ["Email", d.email], ["Phone", d.phone ? d.phone : "—"], ["Delivery", d.delivery]);
  if (s.kind === "quote") {
    out.push(["Photos", photos.length > 0 ? `${photos.length} attached` : "none"]);
  }
  return out;
}

/** Render the lead email. Every user-supplied value is HTML-escaped. */
export function renderEmail(s: Submission, photos: Photo[] = []): RenderedEmail {
  const subject = buildSubject(s);
  const heading = s.kind === "book" ? "New booking request" : "New quote request";
  const table = rows(s, photos);

  const cell = "padding:8px 12px;border-bottom:1px solid #e5e5e5;vertical-align:top;text-align:left;";
  const tableRows = table
    .map(
      ([label, value]) =>
        `<tr><th scope="row" style="${cell}color:#555;font-weight:600;white-space:nowrap;">${escapeHtml(label)}</th>` +
        `<td style="${cell}">${escapeHtml(value).replace(/\n/g, "<br>")}</td></tr>`,
    )
    .join("");

  const html =
    `<!doctype html><html><body style="margin:0;padding:24px;background:#f6f6f6;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#111;">` +
    `<div style="max-width:640px;margin:0 auto;background:#fff;border-radius:8px;padding:24px;">` +
    `<h1 style="font-size:20px;margin:0 0 16px;">${escapeHtml(heading)}</h1>` +
    `<table role="presentation" style="border-collapse:collapse;width:100%;font-size:14px;">${tableRows}</table>` +
    `<h2 style="font-size:16px;margin:24px 0 8px;">Message</h2>` +
    `<div style="white-space:pre-wrap;font-size:14px;line-height:1.5;padding:12px;background:#fafafa;border-radius:6px;">${escapeHtml(s.data.message)}</div>` +
    `<p style="font-size:12px;color:#777;margin:24px 0 0;">Reply to this email to answer ${escapeHtml(s.data.name)} directly. Sent from the Mod Labs website.</p>` +
    `</div></body></html>`;

  const text = [
    heading,
    "",
    ...table.map(([label, value]) => `${label}: ${value.replace(/\n/g, ", ")}`),
    "",
    "Message:",
    s.data.message,
    "",
    "Reply to this email to answer the customer directly.",
  ].join("\n");

  return { subject, html, text, replyTo: s.data.email };
}

type BufferLike = { from(data: ArrayBuffer): { toString(encoding: "base64"): string } };

/** Base64-encode bytes efficiently: native Buffer (nodejs_compat) or chunked btoa fallback. */
export function toBase64(bytes: ArrayBuffer): string {
  const NodeBuffer = (globalThis as { Buffer?: BufferLike }).Buffer;
  if (NodeBuffer) return NodeBuffer.from(bytes).toString("base64");
  const u8 = new Uint8Array(bytes);
  const chunks: string[] = [];
  const CHUNK = 0x8000;
  for (let i = 0; i < u8.length; i += CHUNK) {
    chunks.push(String.fromCharCode.apply(null, u8.subarray(i, i + CHUNK) as unknown as number[]));
  }
  return btoa(chunks.join(""));
}

export async function toAttachments(photos: Photo[]): Promise<Attachment[]> {
  return Promise.all(
    photos.map(async (p, i) => ({
      filename: safeFilename(p.name, `photo-${i + 1}.${EXT[p.type] ?? "jpg"}`),
      content: toBase64(await p.file.arrayBuffer()),
      content_type: p.type,
    })),
  );
}
