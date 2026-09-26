import { describe, expect, it } from "vitest";
import type { VideoRecord } from "../../src/lib/gallery/video-records.ts";
import { ListError, moveItems, removeItems, restoreItems } from "../lib/list-ops.ts";
import { clearPosters, posterThumbId, relinkPosters, updateVideo } from "../lib/video-ops.ts";

const videos: VideoRecord[] = [
  { id: 1, file: "halo-xbox.mp4", project: "a", title: "One", posterId: 11 },
  { id: 2, file: "v0002.mp4", project: "a", title: "Two" },
  { id: 3, file: "v0003.mp4", project: "b", title: "Three", posterId: 11 },
];
const photos = [
  { id: 10, project: "a" },
  { id: 11, project: "a" },
  { id: 20, project: "b" },
];
const photoIdsIn = (project: string) => photos.filter((p) => p.project === project).map((p) => p.id);

describe("updateVideo", () => {
  it("changes the title, sets a poster from the project, or goes back to auto", () => {
    expect(updateVideo(videos, 2, { title: "Renamed" }, photoIdsIn)[1]).toEqual({
      ...videos[1],
      title: "Renamed",
    });
    expect(updateVideo(videos, 2, { posterId: 10 }, photoIdsIn)[1].posterId).toBe(10);
    const auto = updateVideo(videos, 1, { posterId: null }, photoIdsIn)[0];
    expect(auto).toEqual({ id: 1, file: "halo-xbox.mp4", project: "a", title: "One" });
    expect("posterId" in auto).toBe(false);
  });

  it("refuses a poster from another project and an unknown video", () => {
    expect(() => updateVideo(videos, 2, { posterId: 20 }, photoIdsIn)).toThrow(ListError);
    expect(() => updateVideo(videos, 99, { title: "x" }, photoIdsIn)).toThrow(/isn't in the gallery/);
  });
});

describe("posters when photos are deleted and restored", () => {
  it("clears posters that point at deleted photos and re-links them on restore", () => {
    const { list, posterOf } = clearPosters(videos, [11, 20]);
    expect(list.map((v) => v.posterId)).toEqual([undefined, undefined, undefined]);
    expect([...posterOf]).toEqual([[11, [1, 3]]]);
    expect(relinkPosters(list, posterOf)).toEqual(videos);
  });

  it("doesn't overwrite a poster chosen while the photo was in the trash", () => {
    const { list, posterOf } = clearPosters(videos, [11]);
    const chosen = list.map((v) => (v.id === 1 ? { ...v, posterId: 10 } : v));
    expect(relinkPosters(chosen, posterOf)[0].posterId).toBe(10);
  });
});

describe("posterThumbId (mirrors the site's videoPoster)", () => {
  it("uses the chosen photo while it's in the project, else the project cover, else none", () => {
    expect(posterThumbId(videos[0], photos)).toBe(11);
    expect(posterThumbId(videos[1], photos)).toBe(10); // auto = cover
    expect(posterThumbId(videos[2], photos)).toBe(20); // poster 11 is in another project
    expect(posterThumbId({ ...videos[1], project: "empty" }, photos)).toBeNull();
  });
});

describe("shared list ops work on videos", () => {
  it("reorders, moves across projects and restores exactly", () => {
    expect(moveItems(videos, [2], "a", 1).map((v) => v.id)).toEqual([2, 1, 3]);
    expect(moveItems(videos, [1], "b").find((v) => v.id === 1)?.project).toBe("b");
    const { list, removals } = removeItems(videos, [3, 1]);
    expect(restoreItems(list, removals)).toEqual(videos);
  });
});
