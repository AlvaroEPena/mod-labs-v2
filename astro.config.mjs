// @ts-check
import { defineConfig, fontProviders } from "astro/config";
import tailwindcss from "@tailwindcss/vite";
import sitemap from "@astrojs/sitemap";

// Update when a custom domain is added (also PUBLIC_SITE_URL).
const site = process.env.PUBLIC_SITE_URL ?? "https://mod-labs.workers.dev";

export default defineConfig({
  site,
  output: "static",
  trailingSlash: "never",
  build: { format: "file", inlineStylesheets: "auto" },
  compressHTML: true,
  prefetch: { prefetchAll: true, defaultStrategy: "hover" },
  image: { responsiveStyles: false },
  redirects: { "/contact": "/quote" },
  integrations: [
    sitemap({
      filter: (page) => !/\/(404|contact)$/.test(page.replace(/\/$/, "")),
    }),
  ],
  fonts: [
    {
      // Technical display face for headings, labels and prices (variable: one file for every weight)
      provider: fontProviders.google(),
      name: "Oxanium",
      cssVariable: "--font-oxanium",
      weights: ["500 800"],
      styles: ["normal"],
      subsets: ["latin"],
      fallbacks: ["ui-sans-serif", "system-ui", "sans-serif"],
    },
    {
      // Clean variable sans for body copy
      provider: fontProviders.google(),
      name: "Geist",
      cssVariable: "--font-geist",
      weights: ["400 700"],
      styles: ["normal"],
      subsets: ["latin"],
      fallbacks: ["ui-sans-serif", "system-ui", "sans-serif"],
    },
  ],
  vite: { plugins: [tailwindcss()] },
});
