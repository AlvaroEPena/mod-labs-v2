import type { ImageMetadata } from "astro";
import records from "./photos.json";
import { projects, type CategorySlug } from "./projects";
import { validatePhotoRecords, type PhotoRecord } from "../lib/gallery/records";

export { categories, categorySlugs, projects } from "./projects";
export type { Category, CategorySlug, Project } from "./projects";

export type Photo = {
  id: number;
  category: CategorySlug;
  project: string;
  file: string;
  width: number;
  height: number;
  image: ImageMetadata;
  alt: string;
};

const images = import.meta.glob<{ default: ImageMetadata }>("../assets/gallery/photos/*.jpg", {
  eager: true,
});

type LoadedRecord = PhotoRecord & { image: ImageMetadata };

/**
 * photos.json is edited by hand or by the local photo admin (`npm run admin`), so check it at
 * build time and fail with every problem listed rather than rendering a broken gallery.
 */
function loadRecords(): LoadedRecord[] {
  const result = validatePhotoRecords(
    records,
    projects.map((p) => p.slug),
  );
  const problems = result.ok ? [] : [...result.problems];
  const loaded: LoadedRecord[] = [];
  for (const r of result.ok ? result.records : []) {
    const image = images[`../assets/gallery/${r.file}`]?.default;
    if (!image) problems.push(`id ${r.id}: file src/assets/gallery/${r.file} does not exist.`);
    else if (image.width !== r.width || image.height !== r.height) {
      problems.push(
        `id ${r.id}: photos.json says ${r.width}x${r.height} but the file is ${image.width}x${image.height}.`,
      );
    } else loaded.push({ ...r, image });
  }
  if (result.ok && result.records.length === 0)
    problems.push("photos.json has no photos; the site needs at least one.");
  if (problems.length) {
    throw new Error(
      `Invalid src/data/photos.json (fix it or use npm run admin):\n- ${problems.join("\n- ")}`,
    );
  }
  return loaded;
}

const categoryOf = new Map(projects.map((p) => [p.slug, p.category]));
const titleOf = new Map(projects.map((p) => [p.slug, p.title]));

function buildPhotos(list: LoadedRecord[]): Photo[] {
  const totals = new Map<string, number>();
  for (const r of list) totals.set(r.project, (totals.get(r.project) ?? 0) + 1);
  const seen = new Map<string, number>();
  return list.map((r) => {
    const n = (seen.get(r.project) ?? 0) + 1;
    seen.set(r.project, n);
    return {
      ...r,
      // validated in loadRecords: every project is known
      category: categoryOf.get(r.project) as CategorySlug,
      alt: `${titleOf.get(r.project)}, photo ${n} of ${totals.get(r.project)}`,
    };
  });
}

/** All photos in display order (array order within each project; first = project cover). */
export const photos: Photo[] = buildPhotos(loadRecords());

export const photoById = (id: number): Photo | undefined => photos.find((p) => p.id === id);
export const photosFor = (projectSlug: string) => photos.filter((p) => p.project === projectSlug);
export const photosInCategory = (c: CategorySlug) => photos.filter((p) => p.category === c);
export const projectsInCategory = (c: CategorySlug) =>
  projects.filter((p) => p.category === c && photosFor(p.slug).length > 0);
export const coverFor = (projectSlug: string) => photosFor(projectSlug)[0];
