import { describe, expect, it } from "vitest";
import { photoFileForId, type PhotoRecord } from "../../src/lib/gallery/records.ts";
import {
  addPhoto,
  arrangeProjects,
  movePhotos,
  nextPhotoId,
  PhotoListError,
  removePhotos,
  restorePhotos,
} from "../lib/photos.ts";

const rec = (id: number, project: string): PhotoRecord => ({
  id,
  file: photoFileForId(id),
  project,
  width: 10,
  height: 10,
});
/** a: 1,2,3 · b: 4,5 · a again: 6 (projects can be interleaved in the list) */
const list = [rec(1, "a"), rec(2, "a"), rec(3, "a"), rec(4, "b"), rec(5, "b"), rec(6, "a")];
const ids = (l: readonly PhotoRecord[], project?: string) =>
  l.filter((p) => !project || p.project === project).map((p) => p.id);

function expectListError(fn: () => unknown, code: string) {
  let thrown: unknown;
  try {
    fn();
  } catch (err) {
    thrown = err;
  }
  expect(thrown).toBeInstanceOf(PhotoListError);
  expect((thrown as PhotoListError).code).toBe(code);
}

describe("movePhotos", () => {
  it("appends photos from several projects to the target, keeping their relative order", () => {
    const next = movePhotos(list, [5, 2, 6], "c");
    expect(ids(next, "c")).toEqual([2, 5, 6]); // list order, not request order
    expect(ids(next, "a")).toEqual([1, 3]);
    expect(ids(next, "b")).toEqual([4]);
  });

  it("places photos right before another photo (drag and drop / keyboard)", () => {
    expect(ids(movePhotos(list, [6], "a", 2), "a")).toEqual([1, 6, 2, 3]);
    expect(ids(movePhotos(list, [1], "a", null), "a")).toEqual([2, 3, 6, 1]);
    const across = movePhotos(list, [1, 3], "b", 5);
    expect(ids(across, "b")).toEqual([4, 1, 3, 5]);
    expect(ids(across, "a")).toEqual([2, 6]);
  });

  it("is all-or-nothing: one bad id refuses the whole batch", () => {
    expectListError(() => movePhotos(list, [1, 99], "b"), "not_found");
    expectListError(() => movePhotos(list, [1, 1], "b"), "invalid");
    expectListError(() => movePhotos(list, [], "b"), "invalid");
  });

  it("refuses a drop target that moved or is part of the batch", () => {
    expectListError(() => movePhotos(list, [1], "b", 2), "stale"); // 2 isn't in b
    expectListError(() => movePhotos(list, [1, 2], "a", 2), "invalid");
  });

  it("does not mutate its input", () => {
    movePhotos(list, [1, 4], "c");
    expect(ids(list)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(list[0].project).toBe("a");
  });
});

describe("arrangeProjects", () => {
  it("sets the exact contents and order of several projects (undo of a move)", () => {
    const moved = movePhotos(list, [2, 5], "b", 4);
    const undone = arrangeProjects(moved, { a: [1, 2, 3, 6], b: [4, 5] });
    expect(ids(undone, "a")).toEqual([1, 2, 3, 6]);
    expect(ids(undone, "b")).toEqual([4, 5]);
    expect(undone.find((p) => p.id === 2)?.project).toBe("a");
  });

  it("reorders a single project", () => {
    expect(ids(arrangeProjects(list, { a: [6, 3, 2, 1] }), "a")).toEqual([6, 3, 2, 1]);
  });

  it("allows emptying a project", () => {
    const next = arrangeProjects(list, { a: [1, 2, 3, 6, 4, 5], b: [] });
    expect(ids(next, "b")).toEqual([]);
    expect(ids(next, "a")).toEqual([1, 2, 3, 6, 4, 5]);
  });

  it("refuses a layout that isn't exactly the current photos of those projects", () => {
    expectListError(() => arrangeProjects(list, { a: [1, 2, 3] }), "stale");
    expectListError(() => arrangeProjects(list, { a: [1, 2, 3, 6, 6] }), "stale");
    expectListError(() => arrangeProjects(list, { a: [1, 2, 3, 6, 4] }), "stale"); // 4 lives in b
  });
});

describe("removePhotos + restorePhotos", () => {
  it("remembers each photo's neighbour and index", () => {
    const { list: without, removals } = removePhotos(list, [6]);
    expect(removals[0].placement).toEqual({ afterId: 3, index: 5 }); // 4 and 5 are project b
    expect(ids(without)).toEqual([1, 2, 3, 4, 5]);
  });

  it("round-trips any batch to the identical list when nothing else changed", () => {
    for (const batch of [[1], [6], [2, 5], [6, 1, 4], [1, 2, 3, 4, 5, 6], [3, 2, 1]]) {
      const { list: without, removals } = removePhotos(list, batch);
      expect(restorePhotos(without, removals), String(batch)).toEqual(list);
    }
  });

  it("restores next to the old neighbour when the project changed in between", () => {
    const { list: without, removals } = removePhotos(list, [2]); // a: 1,[2],3,6
    const shuffled = arrangeProjects(without, { a: [3, 1, 6] });
    expect(ids(restorePhotos(shuffled, removals), "a")).toEqual([3, 1, 2, 6]);
  });

  it("restores a former cover as the cover, and falls back to the end of the project", () => {
    const first = removePhotos(list, [1]);
    expect(ids(restorePhotos(arrangeProjects(first.list, { a: [6, 2, 3] }), first.removals), "a")).toEqual([
      1, 6, 2, 3,
    ]);
    const third = removePhotos(list, [3]);
    const neighbourMoved = movePhotos(third.list, [2], "b");
    expect(ids(restorePhotos(neighbourMoved, third.removals), "a")).toEqual([1, 6, 3]);
  });

  it("is all-or-nothing", () => {
    expectListError(() => removePhotos(list, [1, 99]), "not_found");
    expectListError(
      () => restorePhotos(list, [{ record: rec(1, "a"), placement: { afterId: null, index: 0 } }]),
      "invalid",
    );
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
