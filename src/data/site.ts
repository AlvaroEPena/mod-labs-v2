/** Global site config. Fill in socials when accounts exist; empty values are hidden in the UI. */
export const site = {
  name: "Mod Labs",
  tagline: "Console modding & electronics repair",
  owner: "Alvaro",
  location: { city: "Seattle", region: "WA", country: "US" },
  description:
    "Seattle console modding and electronics repair: Xbox 360 RGH, Nintendo Switch modchips (OLED Kamikaze, V1/V2, Lite), custom handheld Wii builds and board-level repair.",
  url: import.meta.env.PUBLIC_SITE_URL ?? "http://localhost:4321",
  serviceArea: {
    local: "Local drop-off in the Seattle area. Fast turnaround, often same or next day.",
    mailIn: "Mail-in available. Reach out and we'll work out shipping and details together.",
  },
  socials: {
    /** e.g. "https://instagram.com/modlabs" (account coming soon) */
    instagram: "",
    tiktok: "",
    /** Discord invite URL or username */
    discord: "",
  },
} as const;

export type Site = typeof site;
