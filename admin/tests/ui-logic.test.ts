/** The browser UI's pure logic (no DOM): ordering/prediction helpers and the selection model. */
import { describe, expect, it, vi } from "vitest";
import { movePhotos as serverMovePhotos } from "../lib/photos.ts";
import { idAfter, idsBetween, layoutOf, moveBy, moveTo, movePhotos, sameLayout } from "../public/order.js";
import { createSelection } from "../public/select.js";

const photos = [
  { id: 1, project: "a" },
  { id: 2, project: "a" },
  { id: 3, project: "a" },
  { id: 4, project: "b" },
  { id: 5, project: "b" },
];
const full = photos.map((p) => ({
  ...p,
  file: `photos/p${String(p.id).padStart(4, "0")}.jpg`,
  width: 1,
  height: 1,
}));
const idsOf = (list: { id: number; project: string }[], project: string) =>
  list.filter((p) => p.project === project).map((p) => p.id);

describe("keyboard ordering helpers", () => {
  it("moves by a step or to an end, clamped", () => {
    expect(moveBy([1, 2, 3], 3, -1)).toEqual([1, 3, 2]);
    expect(moveBy([1, 2, 3], 1, -1)).toEqual([1, 2, 3]);
    expect(moveTo([1, 2, 3], 3, 0)).toEqual([3, 1, 2]);
    expect(moveTo([1, 2, 3], 1, 3)).toEqual([2, 3, 1]);
  });

  it("finds the drop target the server needs (null = end)", () => {
    expect(idAfter([3, 1, 2], 3)).toBe(1);
    expect(idAfter([1, 2, 3], 3)).toBeNull();
  });
});

describe("movePhotos (UI prediction)", () => {
  it("matches the server's rules so the page never jumps after saving", () => {
    const cases: [number[], string, number | null][] = [
      [[3], "a", 1],
      [[1], "a", null],
      [[1, 4], "a", 2],
      [[2, 5], "b", 4],
      [[1, 2, 3], "c", null],
    ];
    for (const [ids, project, beforeId] of cases) {
      const ui = movePhotos(photos, ids, project, beforeId);
      const server = serverMovePhotos(full, ids, project, beforeId);
      for (const slug of ["a", "b", "c"])
        expect(idsOf(ui, slug), `${ids}→${project}`).toEqual(idsOf(server, slug));
    }
  });
});

describe("layouts (undo snapshots)", () => {
  it("snapshots and compares project contents", () => {
    const before = layoutOf(photos, ["a", "b", "a"]);
    expect(before).toEqual({ a: [1, 2, 3], b: [4, 5] });
    expect(sameLayout(before, layoutOf(photos, ["b", "a"]))).toBe(true);
    expect(sameLayout(before, layoutOf(movePhotos(photos, [3], "a", 1), ["a", "b"]))).toBe(false);
    expect(sameLayout(before, layoutOf(movePhotos(photos, [3], "a", null), ["a", "b"]))).toBe(true); // no-op drop
  });

  it("idsBetween gives Shift-click ranges in either direction", () => {
    expect(idsBetween([1, 2, 3, 4], 2, 4)).toEqual([2, 3, 4]);
    expect(idsBetween([1, 2, 3, 4], 4, 2)).toEqual([2, 3, 4]);
    expect(idsBetween([1, 2, 3, 4], 9, 2)).toEqual([]);
  });
});

describe("selection model", () => {
  it("toggles, selects ranges from the last click, spans projects and clears", () => {
    const onChange = vi.fn();
    const s = createSelection(onChange);
    s.toggle(1);
    s.extendTo([1, 2, 3], 3); // Shift-click
    s.toggle(5); // another project
    expect(s.inOrder([1, 2, 3, 4, 5])).toEqual([1, 2, 3, 5]);
    expect(s.size).toBe(4);
    s.toggle(2);
    expect(s.has(2)).toBe(false);
    s.clear();
    expect(s.size).toBe(0);
    expect(onChange).toHaveBeenCalledTimes(5);
  });

  it("treats a Shift-click without an anchor as a plain toggle, and selects/deselects a project", () => {
    const s = createSelection(() => {});
    s.extendTo([1, 2, 3], 2);
    expect(s.inOrder([1, 2, 3])).toEqual([2]);
    s.setMany([1, 2, 3], true);
    expect(s.size).toBe(3);
    s.setMany([1, 2], false);
    expect(s.inOrder([1, 2, 3])).toEqual([3]);
  });

  it("prunes ids that no longer exist without notifying", () => {
    const onChange = vi.fn();
    const s = createSelection(onChange);
    s.setMany([1, 2, 3], true);
    onChange.mockClear();
    s.prune([2]);
    expect(s.inOrder([1, 2, 3])).toEqual([2]);
    expect(onChange).not.toHaveBeenCalled();
  });
});
