// @ts-check
import { defineConfig, fontProviders } from "astro/config";
import tailwindcss from "@tailwindcss/vite";
import sitemap from "@astrojs/sitemap";
import { loadEnv } from "vite";

// Astro doesn't load .env files before reading this config, so load them the same way Vite does
// (`astro build` = production mode → .env + .env.production). Set PUBLIC_SITE_URL there.
const mode = process.argv.includes("dev") ? "development" : "production";
const env = { ...loadEnv(mode, process.cwd(), "PUBLIC_"), ...process.env };
const site = env.PUBLIC_SITE_URL || "http://localhost:4321";

export default defineConfig({
  site,
  output: "static",
  trailingSlash: "never",
  build: { format: "file", inlineStylesheets: "auto" },
  compressHTML: true,
  prefetch: { prefetchAll: true, defaultStrategy: "hover" },
  image: { responsiveStyles: false },
  // /contact → /quote is a 301 in public/_redirects (owned by the Worker/backend side)
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
