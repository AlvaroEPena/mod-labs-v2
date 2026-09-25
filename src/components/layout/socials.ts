import { site } from "../../data/site";
import type { IconName } from "../ui/icons";

export type Social = { key: "instagram" | "tiktok" | "discord"; label: string; icon: IconName; url: string; blurb: string };

const meta: Omit<Social, "url">[] = [
  { key: "instagram", label: "Instagram", icon: "instagram", blurb: "Build photos, before/afters and what's on the bench." },
  { key: "tiktok", label: "TikTok", icon: "tiktok", blurb: "Short clips of installs, repairs and custom builds." },
  { key: "discord", label: "Discord", icon: "discord", blurb: "Hang out, ask questions and follow along." },
];

/** Discord may be an invite URL or a plain username; only real URLs become links. */
const asUrl = (v: string) => (/^https?:\/\//i.test(v) ? v : "");

export const socials: Social[] = meta.map((m) => ({ ...m, url: asUrl(site.socials[m.key]) }));
export const liveSocials = socials.filter((s) => s.url);
export const discordHandle = /^https?:\/\//i.test(site.socials.discord) ? "" : site.socials.discord;
