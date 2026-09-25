/**
 * Guards for a server that only ever runs on the owner's own computer. Binding to 127.0.0.1 keeps
 * other machines out; these keep *web pages in the owner's browser* out:
 * - Host allowlist: blocks DNS-rebinding (evil.com re-pointed at 127.0.0.1 would send Host: evil.com).
 * - Origin check on changes: blocks cross-site form posts / fetches (CSRF).
 * - Per-run random token on every API call: another site can't read it from our page (same-origin
 *   policy), and a custom header forces a CORS preflight we never answer.
 */
import { randomBytes, timingSafeEqual } from "node:crypto";

export const TOKEN_HEADER = "x-admin-token";
/** Thumbnails load through <img>, which can't send headers, so they carry the token as `?t=`. */
export const TOKEN_QUERY = "t";

export const createToken = () => randomBytes(24).toString("base64url");

export const allowedHosts = (port: number) => [`127.0.0.1:${port}`, `localhost:${port}`];
export const allowedOrigins = (port: number) => allowedHosts(port).map((h) => `http://${h}`);

export function isAllowedHost(host: string | null, port: number): boolean {
  return host !== null && allowedHosts(port).includes(host.toLowerCase());
}

/** Browsers always send Origin on POST; a missing one means a non-browser client without our page. */
export function isAllowedOrigin(origin: string | null, port: number): boolean {
  return origin !== null && allowedOrigins(port).includes(origin.toLowerCase());
}

export function isValidToken(candidate: string | null, token: string): boolean {
  if (!candidate) return false;
  const a = Buffer.from(candidate);
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Headers for every response: no framing, no sniffing, no referrers (thumb URLs carry the token). */
export const SECURITY_HEADERS: Record<string, string> = {
  "Content-Security-Policy":
    "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' blob:; connect-src 'self'; " +
    "base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "no-referrer",
  "Cross-Origin-Resource-Policy": "same-origin",
  "Cache-Control": "no-store",
};
