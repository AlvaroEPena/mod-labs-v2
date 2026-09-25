import type { APIRoute } from "astro";

export const GET: APIRoute = ({ site }) => {
  const base = (site?.toString() ?? "https://mod-labs.workers.dev/").replace(/\/$/, "");
  return new Response(`User-agent: *\nAllow: /\nDisallow: /api/\n\nSitemap: ${base}/sitemap-index.xml\n`, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
};
