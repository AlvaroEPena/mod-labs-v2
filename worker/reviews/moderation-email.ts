/** The "approve or delete?" email sent to the owner for every new review. All review text is escaped. */
import { sourceLabel } from "../../src/lib/reviews/contract";
import type { RenderedEmail } from "../lib/email";
import { escapeHtml, singleLine } from "../lib/escape";
import type { ModerationLink } from "./signing";
import type { StoredReview } from "./store";

export interface ModerationLinks {
  approve: ModerationLink;
  remove: ModerationLink;
}

export const starText = (rating: number) => "★".repeat(rating) + "☆".repeat(5 - rating);

const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);

function fields(review: StoredReview): [string, string][] {
  return [
    ["Name", review.name],
    ["Rating", `${starText(review.rating)} (${review.rating}/5)`],
    ["Service", review.service ?? "—"],
    ["Heard about us", review.source ? sourceLabel(review.source) || review.source : "—"],
  ];
}

export function renderModerationEmail(review: StoredReview, links: ModerationLinks): RenderedEmail {
  const subject = singleLine(`New review: ${review.rating}★ from ${review.name} (approve or delete)`);
  const cell = "padding:8px 12px;border-bottom:1px solid #e5e5e5;vertical-align:top;text-align:left;";
  const rows = fields(review)
    .map(
      ([label, value]) =>
        `<tr><th scope="row" style="${cell}color:#555;font-weight:600;white-space:nowrap;">${escapeHtml(label)}</th>` +
        `<td style="${cell}">${escapeHtml(value)}</td></tr>`,
    )
    .join("");
  const button = (href: string, label: string, color: string) =>
    `<a href="${escapeHtml(href)}" style="display:inline-block;margin:0 8px 8px 0;padding:10px 18px;border-radius:6px;background:${color};color:#fff;text-decoration:none;font-weight:600;">${escapeHtml(label)}</a>`;
  const expiry =
    `Approve link valid until ${day(links.approve.expiresAt)}; delete link valid until ${day(links.remove.expiresAt)} ` +
    "(keep this email to remove the review later). Each link opens a confirmation page; nothing changes until you press its button.";

  const html =
    `<!doctype html><html><body style="margin:0;padding:24px;background:#f6f6f6;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#111;">` +
    `<div style="max-width:640px;margin:0 auto;background:#fff;border-radius:8px;padding:24px;">` +
    `<h1 style="font-size:20px;margin:0 0 8px;">New review waiting for approval</h1>` +
    `<p style="font-size:14px;color:#555;margin:0 0 16px;">Nothing is published until you approve it.</p>` +
    `<table role="presentation" style="border-collapse:collapse;width:100%;font-size:14px;">${rows}</table>` +
    `<h2 style="font-size:16px;margin:24px 0 8px;">Review</h2>` +
    `<div style="white-space:pre-wrap;font-size:14px;line-height:1.5;padding:12px;background:#fafafa;border-radius:6px;">${escapeHtml(review.body)}</div>` +
    `<p style="margin:24px 0 0;">${button(links.approve.url, "Approve and publish", "#15803d")}${button(links.remove.url, "Delete", "#b91c1c")}</p>` +
    `<p style="font-size:12px;color:#777;margin:16px 0 0;">${escapeHtml(expiry)} Sent from the Mod Labs website.</p>` +
    `</div></body></html>`;

  const text = [
    "New review waiting for approval (nothing is published until you approve it).",
    "",
    ...fields(review).map(([label, value]) => `${label}: ${value}`),
    "",
    "Review:",
    review.body,
    "",
    `Approve and publish: ${links.approve.url}`,
    `Delete: ${links.remove.url}`,
    "",
    expiry,
  ].join("\n");

  return { subject, html, text };
}
