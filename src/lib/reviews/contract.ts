/**
 * Review contract (spec §17), shared by the browser form, the Worker API and the HTML injection.
 * Pure and import-free apart from zod, so the Worker, the site build and tests can all load it.
 *
 * Security model: anyone can SUBMIT; nothing is PUBLISHED until the owner approves it via a signed
 * link. Every string that reaches HTML goes through `escapeHtml` in `renderReviewItem`, the only
 * place review markup is produced.
 */
import { z } from "zod";

z.config({ jitless: true }); // same reason as forms/schema.ts: no eval under the site CSP or in Workers

export const REVIEW_SERVICES = [
  "Xbox 360 RGH",
  "Switch OLED",
  "Switch V1/V2",
  "Switch Lite",
  "Repair",
  "Custom build",
  "Other",
] as const;

/** "How did you hear about Mod Labs?" (optional, owner request). Shown as subtext under the name. */
export const REVIEW_SOURCES = ["Facebook", "Google", "Instagram", "A friend", "Other"] as const;
export type ReviewSource = (typeof REVIEW_SOURCES)[number];

/** Subtext shown for a source; "Other" (or none) shows nothing. */
export const sourceLabel = (source: string | null | undefined): string => {
  switch (source) {
    case "Facebook":
    case "Google":
    case "Instagram":
      return `Found us on ${source}`;
    case "A friend":
      return "Referred by a friend";
    default:
      return "";
  }
};

export const REVIEW_NAME_MAX = 40;
export const REVIEW_BODY_MIN = 20;
export const REVIEW_BODY_MAX = 800;
/** reviews shown on the home page */
export const HOME_REVIEW_LIMIT = 3;

/** Form field names (multipart/form-data). */
export const reviewFields = {
  name: "name",
  rating: "rating",
  service: "service",
  source: "source",
  body: "body",
  consent: "consent",
  honeypot: "hp_7f3",
  turnstile: "cf-turnstile-response",
} as const;

/** Links are the #1 review-spam payload, so reviews can't contain any. */
const LINK_PATTERN = /(https?:\/\/|www\.|\b[a-z0-9-]+\.(?:com|net|org|io|ru|xyz|top|info|biz|store|shop|link|click)\b)/i;

export const reviewSchema = z.object({
  name: z
    .string({ error: "Name is required." })
    .trim()
    .min(2, "Name must be at least 2 characters.")
    .max(REVIEW_NAME_MAX, `Name must be at most ${REVIEW_NAME_MAX} characters.`)
    .regex(/^[\p{L}\p{M}0-9 .'-]+$/u, "Use letters, numbers, spaces, apostrophes, periods or hyphens only."),
  rating: z.coerce
    .number({ error: "Choose a star rating." })
    .int("Choose a star rating.")
    .min(1, "Choose a star rating.")
    .max(5, "Choose a star rating."),
  service: z.enum(REVIEW_SERVICES).optional().or(z.literal("")),
  source: z.enum(REVIEW_SOURCES).optional().or(z.literal("")),
  body: z
    .string({ error: "Review is required." })
    .trim()
    .min(REVIEW_BODY_MIN, `Review must be at least ${REVIEW_BODY_MIN} characters.`)
    .max(REVIEW_BODY_MAX, `Review must be at most ${REVIEW_BODY_MAX} characters.`)
    .refine((v) => !LINK_PATTERN.test(v), "Please leave links out of your review."),
  consent: z.literal("yes", { message: "Please confirm your name and review can be shown on the site." }),
  /** honeypot: must be empty */
  hp: z.string().max(0).optional().or(z.literal("")),
});

export type ReviewInput = z.infer<typeof reviewSchema>;

/** Multipart FormData → the plain object `reviewSchema` expects. */
export function reviewFormToObject(fd: FormData) {
  const get = (k: string) => {
    const v = fd.get(k);
    return typeof v === "string" ? v : undefined;
  };
  return {
    name: get(reviewFields.name),
    rating: get(reviewFields.rating),
    service: get(reviewFields.service),
    source: get(reviewFields.source),
    body: get(reviewFields.body),
    consent: get(reviewFields.consent),
    hp: get(reviewFields.honeypot),
  };
}

/** An approved review as it is published. Never contains private data. */
export type PublicReview = {
  id: number;
  name: string;
  rating: number;
  service: string | null;
  /** how they heard about Mod Labs (REVIEW_SOURCES) */
  source: string | null;
  body: string;
  /** epoch ms when approved */
  approvedAt: number;
};

export type ReviewSummary = { count: number; average: number | null };

/** `GET /api/reviews` success body (approved reviews only). Text is raw: never insert it as HTML. */
export type ReviewListResult = { ok: true; reviews: PublicReview[] } & ReviewSummary;

export const summarize = (reviews: readonly Pick<PublicReview, "rating">[]): ReviewSummary => ({
  count: reviews.length,
  average: reviews.length ? Math.round((reviews.reduce((s, r) => s + r.rating, 0) / reviews.length) * 10) / 10 : null,
});

/** "4.9 average from 12 reviews" / "5.0 from 1 review" / "" when there are none */
export const summaryText = ({ count, average }: ReviewSummary) =>
  count === 0 || average === null ? "" : `${average.toFixed(1)} average from ${count} review${count === 1 ? "" : "s"}`;

const HTML_ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
export const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]!);

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "Nov 2026", in UTC so server and tests agree */
export const reviewDate = (ms: number) => {
  const d = new Date(ms);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
};

/**
 * Markup contract for one published review (styled by the site's .review-card rules).
 * All user text is escaped here; callers must insert the result as HTML only via this function.
 */
export function renderReviewItem(r: PublicReview): string {
  const rating = Math.min(5, Math.max(1, Math.round(r.rating)));
  const stars = Array.from({ length: 5 }, (_, i) => `<span class="star${i < rating ? " is-on" : ""}"></span>`).join("");
  const meta = [r.service ? escapeHtml(r.service) : "", reviewDate(r.approvedAt)].filter(Boolean).join(" · ");
  const source = sourceLabel(r.source);
  const paragraphs = escapeHtml(r.body)
    .split(/\n{2,}/)
    .map((p) => `<p>${p.replace(/\n/g, "<br>")}</p>`)
    .join("");
  return (
    `<li class="review-card"><figure>` +
    `<span class="review-stars" role="img" aria-label="Rated ${rating} out of 5">${stars}</span>` +
    `<blockquote class="review-body">${paragraphs}</blockquote>` +
    `<figcaption class="review-by"><span class="review-name">${escapeHtml(r.name)}</span>` +
    (source ? `<span class="review-source">${escapeHtml(source)}</span>` : "") +
    `<span class="review-meta">${meta}</span></figcaption>` +
    `</figure></li>`
  );
}

/** Where the Worker injects approved reviews at request time (HTMLRewriter selectors). */
export const REVIEW_SLOTS = {
  /** <ul data-reviews-slot="home">: latest HOME_REVIEW_LIMIT reviews */
  home: '[data-reviews-slot="home"]',
  /** <ul data-reviews-slot="all">: every approved review, newest first */
  all: '[data-reviews-slot="all"]',
  /** any element: text content replaced with summaryText() when there is at least one review */
  summary: "[data-reviews-summary]",
  /** elements hidden (attribute `hidden` removed/added) depending on whether reviews exist */
  whenEmpty: "[data-reviews-when-empty]",
  whenAny: "[data-reviews-when-any]",
} as const;
