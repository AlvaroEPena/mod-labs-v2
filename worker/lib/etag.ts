/** ETag helpers for responses the Worker derives from a static asset (RFC 9110 §8.8.3, §13.1.2). */

/** The opaque part of an entity tag: `W/"abc"` / `"abc"` → `abc`. */
const opaqueTag = (tag: string) => tag.trim().replace(/^W\//, "").replace(/^"|"$/g, "");

/**
 * A weak ETag for "this asset + this injected content": it changes whenever either does,
 * so browsers revalidating a rewritten page never keep stale injected HTML.
 */
export function derivedEtag(assetEtag: string | null, contentVersion: string): string | null {
  if (!assetEtag) return null;
  return `W/"${opaqueTag(assetEtag)}.${contentVersion}"`;
}

/** If-None-Match check with weak comparison (what conditional GET requires). */
export function etagMatches(ifNoneMatch: string | null, etag: string): boolean {
  if (!ifNoneMatch) return false;
  if (ifNoneMatch.trim() === "*") return true;
  const wanted = opaqueTag(etag);
  return ifNoneMatch.split(",").some((candidate) => opaqueTag(candidate) === wanted);
}
