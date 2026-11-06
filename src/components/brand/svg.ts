/**
 * Brand SVGs live once, in src/assets/brand (also the source for the favicon/OG generator,
 * scripts/brand-assets.mjs). Components inline them; this splits a file into its viewBox and inner
 * markup and namespaces its ids, so two logos on one page never share a gradient id.
 */
export type InlineSvg = { viewBox: string; body: string };

export function inlineSvg(raw: string, idPrefix: string): InlineSvg {
  const viewBox = raw.match(/viewBox="([^"]+)"/)?.[1] ?? "0 0 64 64";
  const body = raw
    .replace(/^[\s\S]*?<svg[^>]*>/, "")
    .replace(/<\/svg>\s*$/, "")
    .replace(/id="([^"]+)"/g, `id="${idPrefix}-$1"`)
    .replace(/url\(#([^)]+)\)/g, `url(#${idPrefix}-$1)`);
  return { viewBox, body };
}
