import { describe, expect, it } from "vitest";
import { photoById, photos, type Photo } from "../../data/gallery";
import { aboutPhotos, buildCover, categoryCover, heroPhoto, resolvePick, videoPoster } from "./picks";

type P = { id: number; project: string; category: "custom" | "xbox" };
const list: P[] = [
  { id: 1, project: "gwii", category: "custom" },
  { id: 2, project: "gwii", category: "custom" },
  { id: 3, project: "gboy", category: "custom" },
  { id: 4, project: "phat-matrix", category: "xbox" },
];

describe("resolvePick", () => {
  it("returns the picked photo when it's still where it's expected", () => {
    expect(resolvePick(list, { id: 2, project: "gwii" }).id).toBe(2);
    expect(resolvePick(list, { id: 3, category: "custom" }).id).toBe(3);
  });

  it("falls back to the project's first photo when the pick was deleted or moved away", () => {
    expect(resolvePick(list, { id: 99, project: "gwii" }).id).toBe(1);
    expect(resolvePick(list, { id: 3, project: "gwii" }).id).toBe(1); // 3 now lives in gboy
  });

  it("falls back to the category, then to any photo, and never throws", () => {
    expect(resolvePick(list, { id: 99, project: "wii-miicro" }).id).toBe(1); // empty project → its category (custom)
    expect(resolvePick(list, { id: 4, category: "custom" }).id).toBe(1); // moved out of the category
    expect(resolvePick(list, { id: 99, category: "switch" }).id).toBe(1); // empty category → first photo
  });
});

describe("site picks (current data)", () => {
  // The owner can move or delete any photo in the admin, so check the rule rather than fixed ids:
  // the chosen photo while it's still where it was picked, otherwise one from the same place.
  function expectPick(actual: Photo, id: number, where: { project?: string; category?: string }) {
    const chosen = photoById(id);
    const isInPlace =
      chosen && (where.project ? chosen.project === where.project : chosen.category === where.category);
    if (isInPlace) expect(actual.id).toBe(id);
    else if (where.project && photos.some((p) => p.project === where.project))
      expect(actual.project).toBe(where.project);
    else if (where.category) expect(actual.category).toBe(where.category);
  }

  it("resolve to the photos chosen before the id migration (or a sensible fallback)", () => {
    expectPick(heroPhoto(), 340, { project: "gwii" });
    expectPick(buildCover("gwii"), 341, { project: "gwii" });
    expectPick(buildCover("wii-miicro"), 402, { project: "wii-miicro" });
    expectPick(categoryCover("switch"), 52, { category: "switch" });
    expectPick(categoryCover("xbox"), 15, { category: "xbox" });
    expectPick(categoryCover("playstation"), 24, { category: "playstation" });
    expectPick(categoryCover("custom"), 208, { category: "custom" });
    expectPick(categoryCover("repairs"), 41, { category: "repairs" });
    expectPick(videoPoster("halo-xbox"), 19, { project: "halo-xbox" });
  });

  it("lets a video pick its own poster (posterId override), falling back gracefully", () => {
    expectPick(videoPoster("halo-xbox", 18), 18, { project: "halo-xbox" });
    expect(videoPoster("halo-xbox", 999999).project).toBe("halo-xbox");
    expectPick(aboutPhotos().bench, 254, { project: "switch-misc" });
    expectPick(aboutPhotos().board, 351, { project: "gwii" });
  });

  it("gives an unknown build the hero shot and other projects their cover as poster", () => {
    expect(buildCover("nope").id).toBe(heroPhoto().id);
    const gboyCover = photos.find((p) => p.project === "gboy");
    if (gboyCover) expect(videoPoster("gboy").id).toBe(gboyCover.id);
  });
});
