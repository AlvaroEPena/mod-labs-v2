/**
 * Presentation-only photo picks (hero, category covers, featured shots), by photo id.
 * Photos can be moved or deleted in the photo admin at any time, so a pick never throws: if the
 * picked photo is gone or now belongs elsewhere, it falls back to the first photo of the intended
 * project, then of that project's category, then of the whole gallery.
 */
import { photos, projects, type CategorySlug, type Photo } from "../../data/gallery";

/** Where a picked photo is expected to live. `project` wins over `category` when both are set. */
export type PhotoPick = { id: number; project?: string; category?: CategorySlug };

type PickablePhoto = Pick<Photo, "id" | "project" | "category">;

/** Pure fallback chain, exported for tests. `list` must not be empty (gallery.ts enforces that). */
export function resolvePick<P extends PickablePhoto>(list: readonly P[], pick: PhotoPick): P {
  const { project } = pick;
  const category = pick.category ?? projects.find((p) => p.slug === project)?.category;
  const belongs = (p: P) => (project ? p.project === project : !category || p.category === category);

  const picked = list.find((p) => p.id === pick.id);
  if (picked && belongs(picked)) return picked;
  const firstOfProject = project ? list.find((p) => p.project === project) : undefined;
  if (firstOfProject) return firstOfProject;
  const firstOfCategory = category ? list.find((p) => p.category === category) : undefined;
  return firstOfCategory ?? list[0];
}

const pick = (p: PhotoPick): Photo => resolvePick(photos, p);

// Ids resolved from the pre-migration file names (e.g. custom/gwii-01.jpg → 332).
/** GWii running New Super Mario Bros. Wii: a game on screen sells "real hardware" at a glance. */
const HERO: PhotoPick = { id: 340, project: "gwii" };

const CATEGORY_COVERS: Record<CategorySlug, PhotoPick> = {
  switch: { id: 52, category: "switch" }, // switch-oled-kamikaze-01
  xbox: { id: 15, category: "xbox" }, // phat-matrix-03
  playstation: { id: 24, category: "playstation" }, // ps4-pppwn-04
  custom: { id: 208, category: "custom" }, // halo-xbox-08
  repairs: { id: 41, category: "repairs" }, // blue-yeti-usb-04
};

/** Best "beauty shot" per commission build (keyed by build slug). */
const BUILD_COVERS: Record<string, PhotoPick> = {
  gwii: { id: 341, project: "gwii" }, // gwii-04
  "wii-miicro": { id: 402, project: "wii-miicro" }, // wii-miicro-01
};

/** Video posters that shouldn't just use the project cover. */
const VIDEO_POSTERS: Record<string, PhotoPick> = {
  "halo-xbox": { id: 19, project: "halo-xbox" }, // halo-xbox-04
};

export const heroPhoto = () => pick(HERO);
export const categoryCover = (slug: CategorySlug) => pick(CATEGORY_COVERS[slug]);
export const buildCover = (slug: string) => pick(BUILD_COVERS[slug] ?? HERO);
/**
 * Poster for a project video: the video's own posterId, else the project's hand-picked poster, else
 * the project cover (id 0 never exists, so pick() falls back to the cover).
 */
export const videoPoster = (projectSlug: string, posterId?: number) =>
  pick(posterId ? { id: posterId, project: projectSlug } : (VIDEO_POSTERS[projectSlug] ?? { id: 0, project: projectSlug }));

/** About page: the bench shot and a board close-up. */
export const aboutPhotos = () => ({
  bench: pick({ id: 254, project: "switch-misc" }), // switch-misc-02
  board: pick({ id: 351, project: "gwii" }), // gwii-14
});
