// @ts-check
import { defineConfig } from "astro/config";
import tailwindcss from "@tailwindcss/vite";

// Update when a custom domain is added (also PUBLIC_SITE_URL).
const site = process.env.PUBLIC_SITE_URL ?? "https://mod-labs.workers.dev";

export default defineConfig({
  site,
  output: "static",
  trailingSlash: "never",
  build: { format: "file" },
  compressHTML: true,
  prefetch: { prefetchAll: true, defaultStrategy: "hover" },
  image: { responsiveStyles: true },
  redirects: { "/contact": "/quote" },
  vite: { plugins: [tailwindcss()] },
});
