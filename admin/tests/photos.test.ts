import { describe, expect, it } from "vitest";
import { photoFileForId, type PhotoRecord } from "../../src/lib/gallery/records.ts";
import {
  addPhoto,
  movePhoto,
  nextPhotoId,
  PhotoListError,
  removePhoto,
  reorderProject,
  restorePhoto,
} from "../lib/photos.ts";

const rec = (id: number, project: string): PhotoRecord => ({
  id,
  file: photoFileForId(id),
  project,
  width: 10,
  height: 10,
});
/** a: 1,2,3 · b: 4,5 · a again: 6 (projects can be interleaved in the file) */
const list = [rec(1, "a"), rec(2, "a"), rec(3, "a"), rec(4, "b"), rec(5, "b"), rec(6, "a")];
const ids = (l: PhotoRecord[], project?: string) =>
  l.filter((p) => !project || p.project === project).map((p) => p.id);

const expectListError = (fn: () => unknown, code: string) => {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(PhotoListError);
    expect((err as PhotoListError).code).toBe(code);
    return;
  }
  throw new Error("expected a PhotoListError");
};

describe("reorderProject", () => {
  it("reorders only that project's photos, keeping other projects' slots", () => {
    const next = reorderProject(list, "a", [6, 1, 3, 2]);
    expect(ids(next)).toEqual([6, 1, 3, 4, 5, 2]);
    expect(ids(next, "b")).toEqual([4, 5]);
  });

  it("refuses a list that isn't exactly the project's current photos (stale page)", () => {
    expectListError(() => reorderProject(list, "a", [1, 2, 3]), "stale");
    expectListError(() => reorderProject(list, "a", [1, 2, 3, 3]), "stale");
    expectListError(() => reorderProject(list, "a", [1, 2, 3, 4]), "stale");
  });

  it("does not mutate its input", () => {
    reorderProject(list, "a", [6, 3, 2, 1]);
    expect(ids(list)).toEqual([1, 2, 3, 4, 5, 6]);
  });
});

describe("movePhoto", () => {
  it("moves a photo to the end of the target project", () => {
    const next = movePhoto(list, 2, "b");
    expect(ids(next, "b")).toEqual([4, 5, 2]);
    expect(ids(next, "a")).toEqual([1, 3, 6]);
    expect(next.find((p) => p.id === 2)?.project).toBe("b");
  });

  it("appends to the end when the target project is empty, and is a no-op for the same project", () => {
    expect(ids(movePhoto(list, 1, "c"))).toEqual([2, 3, 4, 5, 6, 1]);
    expect(ids(movePhoto(list, 1, "a"))).toEqual(ids(list));
  });

  it("reports an unknown id", () => {
    expectListError(() => movePhoto(list, 99, "b"), "not_found");
  });
});

describe("removePhoto + restorePhoto", () => {
  it("remembers the previous photo in the same project and the exact index", () => {
    const { list: without, placement } = removePhoto(list, 6);
    expect(placement).toEqual({ afterId: 3, index: 5 }); // 4 and 5 sit in between but belong to project b
    expect(ids(without)).toEqual([1, 2, 3, 4, 5]);
  });

  it("round-trips to the identical list when nothing else changed", () => {
    for (const id of [1, 2, 3, 4, 5, 6]) {
      const { list: without, removed, placement } = removePhoto(list, id);
      expect(restorePhoto(without, removed, placement)).toEqual(list);
    }
  });

  it("restores right after its old neighbour when the project was reordered meanwhile", () => {
    const { list: without, removed, placement } = removePhoto(list, 2); // a: 1,[2],3,6
    const shuffled = reorderProject(without, "a", [3, 1, 6]);
    expect(ids(restorePhoto(shuffled, removed, placement), "a")).toEqual([3, 1, 2, 6]);
  });

  it("restores a former cover as the cover again", () => {
    const { list: without, removed, placement } = removePhoto(list, 1);
    expect(placement.afterId).toBeNull();
    const shuffled = reorderProject(without, "a", [6, 2, 3]);
    expect(ids(restorePhoto(shuffled, removed, placement), "a")).toEqual([1, 6, 2, 3]);
  });

  it("goes to the end of its project when the neighbour is gone or moved", () => {
    const { list: without, removed, placement } = removePhoto(list, 3);
    const neighbourMoved = movePhoto(without, 2, "b");
    expect(ids(restorePhoto(neighbourMoved, removed, placement), "a")).toEqual([1, 6, 3]);
  });

  it("refuses to restore a photo that is already in the list", () => {
    expectListError(() => restorePhoto(list, rec(1, "a"), { afterId: null, index: 0 }), "invalid");
  });
});

describe("addPhoto / nextPhotoId", () => {
  it("adds a new photo at the end of its project", () => {
    expect(ids(addPhoto(list, rec(7, "b")))).toEqual([1, 2, 3, 4, 5, 7, 6]);
    expectListError(() => addPhoto(list, rec(2, "b")), "invalid");
  });

  it("never reuses an id: one more than the highest ever seen", () => {
    expect(nextPhotoId([3, 450, 12])).toBe(451);
    expect(nextPhotoId([])).toBe(1);
  });
});
