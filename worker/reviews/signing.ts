/**
 * Signed moderation links: HMAC-SHA256 over `id.action.exp` with REVIEW_SIGNING_KEY (Web Crypto).
 * Verification uses crypto.subtle.verify, which compares MACs in constant time.
 */
import type { Env } from "../lib/env";

export const MODERATE_PATH = "/api/reviews/moderate";
export const MODERATION_ACTIONS = ["approve", "delete"] as const;
export type ModerationAction = (typeof MODERATION_ACTIONS)[number];

const DAY_SECONDS = 86_400;
/** Approve links are short-lived; delete links last a year so a published review can still be removed. */
export const LINK_LIFETIME_SECONDS: Record<ModerationAction, number> = {
  approve: 30 * DAY_SECONDS,
  delete: 365 * DAY_SECONDS,
};
/** Tolerated clock difference between the isolate that signed a link and the one verifying it. */
const CLOCK_SKEW_SECONDS = 300;
export const MIN_SIGNING_KEY_LENGTH = 32;

export interface ModerationParams {
  id: number;
  action: ModerationAction;
  /** expiry, epoch seconds */
  exp: number;
  /** base64url HMAC, no padding */
  sig: string;
}

export interface ModerationLink {
  url: string;
  /** epoch ms */
  expiresAt: number;
}

export type VerifyResult = "ok" | "invalid" | "expired";

/** The configured signing key, or null when it is missing or too short to be safe. */
export function signingKeyFrom(env: Env): string | null {
  const key = env.REVIEW_SIGNING_KEY?.trim();
  return key && key.length >= MIN_SIGNING_KEY_LENGTH ? key : null;
}

const encoder = new TextEncoder();
const SIG_PATTERN = /^[A-Za-z0-9_-]{43}$/; // 32 bytes as unpadded base64url

let keyCache: { secret: string; key: Promise<CryptoKey> } | null = null;
function hmacKey(secret: string): Promise<CryptoKey> {
  if (keyCache?.secret !== secret) {
    const raw = encoder.encode(secret);
    keyCache = {
      secret,
      key: crypto.subtle.importKey("raw", raw, { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]),
    };
  }
  return keyCache.key;
}

const signedMessage = (id: number, action: ModerationAction, exp: number) =>
  encoder.encode(`${id}.${action}.${exp}`);

function toBase64Url(bytes: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function fromBase64Url(value: string): Uint8Array {
  const binary = atob(value.replace(/-/g, "+").replace(/_/g, "/") + "=");
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

const isAction = (value: string | null): value is ModerationAction =>
  value !== null && (MODERATION_ACTIONS as readonly string[]).includes(value);

export async function signModeration(
  secret: string,
  id: number,
  action: ModerationAction,
  exp: number,
): Promise<string> {
  return toBase64Url(await crypto.subtle.sign("HMAC", await hmacKey(secret), signedMessage(id, action, exp)));
}

/** A signed link that expires LINK_LIFETIME_SECONDS[action] from `nowMs`. */
export async function createModerationLink(
  origin: string,
  secret: string,
  id: number,
  action: ModerationAction,
  nowMs: number,
): Promise<ModerationLink> {
  const exp = Math.floor(nowMs / 1000) + LINK_LIFETIME_SECONDS[action];
  const url = new URL(MODERATE_PATH, origin);
  url.search = new URLSearchParams({
    id: String(id),
    action,
    exp: String(exp),
    sig: await signModeration(secret, id, action, exp),
  }).toString();
  return { url: url.toString(), expiresAt: exp * 1000 };
}

/** Strictly parse link parameters (query string or form body). Anything malformed → null. */
export function parseModerationParams(read: (name: string) => string | null): ModerationParams | null {
  const id = read("id");
  const action = read("action");
  const exp = read("exp");
  const sig = read("sig");
  if (id === null || !/^[1-9]\d{0,14}$/.test(id)) return null;
  if (!isAction(action)) return null;
  if (exp === null || !/^[1-9]\d{0,11}$/.test(exp)) return null;
  if (sig === null || !SIG_PATTERN.test(sig)) return null;
  return { id: Number(id), action, exp: Number(exp), sig };
}

/** Signature first (so expiry is only reported for genuine links), then the lifetime policy. */
export async function verifyModeration(
  secret: string,
  params: ModerationParams,
  nowMs: number,
): Promise<VerifyResult> {
  const { id, action, exp, sig } = params;
  const mac = fromBase64Url(sig);
  // Reject non-canonical encodings (a different last character can decode to the same bytes), so each
  // link has exactly one valid spelling. This compares the input with itself, not with the secret MAC.
  if (toBase64Url(mac.buffer as ArrayBuffer) !== sig) return "invalid";
  const isGenuine = await crypto.subtle.verify(
    "HMAC",
    await hmacKey(secret),
    mac,
    signedMessage(id, action, exp),
  );
  if (!isGenuine) return "invalid";
  const nowSeconds = Math.floor(nowMs / 1000);
  if (exp - nowSeconds > LINK_LIFETIME_SECONDS[action] + CLOCK_SKEW_SECONDS) return "invalid";
  if (exp <= nowSeconds) return "expired";
  return "ok";
}
