/** Presentation-only photo picks (hero, category covers, featured shots). Data lives in src/data. */
import { photos, type CategorySlug, type Photo } from "../../data/gallery";

export function photoByFile(file: string): Photo {
  const p = photos.find((x) => x.file === file);
  if (!p) throw new Error(`Photo not found: ${file}`);
  return p;
}

export const heroPhoto = () => photoByFile("custom/gwii-01.jpg");

/** Hand-picked covers per category (strongest single image of each). */
const categoryCoverFiles: Record<CategorySlug, string> = {
  switch: "switch/switch-oled-kamikaze-01.jpg",
  xbox: "xbox/phat-matrix-03.jpg",
  playstation: "playstation/ps4-pppwn-04.jpg",
  custom: "custom/halo-xbox-08.jpg",
  repairs: "repairs/blue-yeti-usb-04.jpg",
};

export const categoryCover = (slug: CategorySlug) => {
  try {
    return photoByFile(categoryCoverFiles[slug]);
  } catch {
    return photos.find((p) => p.category === slug)!;
  }
};

/** Best "beauty shot" per commission build. */
const buildCoverFiles: Record<string, string> = {
  gwii: "custom/gwii-04.jpg",
  "wii-miicro": "custom/wii-miicro-01.jpg",
};
export const buildCover = (slug: string) => photoByFile(buildCoverFiles[slug] ?? "custom/gwii-01.jpg");
