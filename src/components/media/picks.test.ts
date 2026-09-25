import { describe, expect, it } from "vitest";
import { photoById, photos } from "../../data/gallery";
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
  it("resolve to the photos chosen before the id migration", () => {
    expect(heroPhoto().id).toBe(332);
    expect(buildCover("gwii").id).toBe(341);
    expect(buildCover("wii-miicro").id).toBe(402);
    expect(categoryCover("switch").id).toBe(52);
    expect(categoryCover("xbox").id).toBe(15);
    expect(categoryCover("playstation").id).toBe(24);
    expect(categoryCover("custom").id).toBe(208);
    expect(categoryCover("repairs").id).toBe(41);
    expect(videoPoster("halo-xbox").id).toBe(19);
    expect(aboutPhotos().bench.id).toBe(254);
    expect(aboutPhotos().board.id).toBe(351);
  });

  it("gives an unknown build the hero shot and other projects their cover as poster", () => {
    expect(buildCover("nope").id).toBe(332);
    expect(videoPoster("gboy").id).toBe(photos.find((p) => p.project === "gboy")?.id);
    expect(photoById(332)?.project).toBe("gwii");
  });
});
