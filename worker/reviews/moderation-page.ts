/** Self-contained HTML pages for the moderation links: no scripts, nonce'd inline CSS, strict CSP. */
import { sourceLabel } from "../../src/lib/reviews/contract";
import { escapeHtml } from "../lib/escape";
import { withSecurityHeaders } from "../lib/http";
import { starText } from "./moderation-email";
import { MODERATE_PATH, type ModerationParams } from "./signing";
import type { StoredReview } from "./store";

export interface ModerationPage {
  status: number;
  title: string;
  message: string;
  review?: StoredReview;
  /** a form that POSTs the same signed parameters (the only way to change anything) */
  confirm?: { params: ModerationParams; label: string; isDestructive: boolean };
}

const STYLE = [
  ":root{color-scheme:light;font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;line-height:1.5;color:#111;background:#f4f4f6}",
  "body{margin:0;padding:24px 16px}",
  "main{max-width:600px;margin:0 auto;background:#fff;border-radius:12px;padding:24px;box-shadow:0 1px 3px rgb(0 0 0/.08)}",
  "h1{font-size:1.4rem;margin:0 0 8px}",
  "dl{display:grid;grid-template-columns:max-content 1fr;gap:4px 16px;margin:16px 0}",
  "dt{color:#555;font-weight:600}dd{margin:0}",
  "blockquote{margin:0 0 16px;padding:12px 16px;background:#f7f7f9;border-left:4px solid #6b7280;border-radius:6px;white-space:pre-wrap;overflow-wrap:anywhere}",
  "button{font:inherit;font-weight:600;color:#fff;background:#15803d;border:0;border-radius:8px;padding:12px 20px;min-height:44px;cursor:pointer}",
  "button.danger{background:#b91c1c}",
  "button:focus-visible,a:focus-visible{outline:3px solid #1d4ed8;outline-offset:2px}",
  "a{color:#1d4ed8}",
].join("");

const newNonce = () => btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16))));

function reviewDetails(review: StoredReview): string {
  const rows: [string, string][] = [
    ["Name", review.name],
    ["Rating", `${starText(review.rating)} (${review.rating}/5)`],
    ["Service", review.service ?? "—"],
    ["Heard about us", review.source ? sourceLabel(review.source) || review.source : "—"],
    ["Submitted", new Date(review.createdAt).toISOString().slice(0, 10)],
    ["Status", review.status === "approved" ? "Published" : "Waiting for approval"],
  ];
  const dl = rows
    .map(([label, value]) => `<dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd>`)
    .join("");
  return `<dl>${dl}</dl><blockquote>${escapeHtml(review.body)}</blockquote>`;
}

function confirmForm({ params, label, isDestructive }: NonNullable<ModerationPage["confirm"]>): string {
  const hidden = (
    Object.entries({ id: params.id, action: params.action, exp: params.exp, sig: params.sig }) as [
      string,
      string | number,
    ][]
  )
    .map(([name, value]) => `<input type="hidden" name="${name}" value="${escapeHtml(String(value))}">`)
    .join("");
  return (
    `<form method="post" action="${MODERATE_PATH}">${hidden}` +
    `<button type="submit"${isDestructive ? ' class="danger"' : ""}>${escapeHtml(label)}</button></form>`
  );
}

export function renderModerationPage(page: ModerationPage, nonce: string): string {
  return (
    `<!doctype html><html lang="en"><head><meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex, nofollow">` +
    `<title>${escapeHtml(page.title)} · Mod Labs reviews</title><style nonce="${nonce}">${STYLE}</style></head>` +
    `<body><main><h1>${escapeHtml(page.title)}</h1><p>${escapeHtml(page.message)}</p>` +
    (page.review ? reviewDetails(page.review) : "") +
    (page.confirm ? confirmForm(page.confirm) : "") +
    `<p><a href="/reviews">Go to the reviews page</a></p></main></body></html>`
  );
}

export function moderationPageResponse(page: ModerationPage): Response {
  const nonce = newNonce();
  const headers = withSecurityHeaders({
    "Content-Type": "text/html; charset=utf-8",
    "Content-Security-Policy": `default-src 'none'; style-src 'nonce-${nonce}'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'`,
    // Not no-referrer: under no-referrer browsers send `Origin: null` with the confirm POST, which the
    // same-origin check rejects. same-origin still never sends the signed URL to another site.
    "Referrer-Policy": "same-origin",
    "X-Robots-Tag": "noindex, nofollow",
    "Cross-Origin-Opener-Policy": "same-origin",
  });
  return new Response(renderModerationPage(page, nonce), { status: page.status, headers });
}
