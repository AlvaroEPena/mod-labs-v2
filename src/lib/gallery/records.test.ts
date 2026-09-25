import { describe, expect, it } from "vitest";
import {
  formatPhotosJson,
  groupByProject,
  photoFileForId,
  validatePhotoRecords,
  type PhotoRecord,
} from "./records";

const known = ["gwii", "gboy"];
const rec = (id: number, project = "gwii"): PhotoRecord => ({
  id,
  file: photoFileForId(id),
  project,
  width: 800,
  height: 600,
});

describe("photoFileForId", () => {
  it("zero-pads to four digits and keeps longer ids intact", () => {
    expect(photoFileForId(7)).toBe("photos/p0007.jpg");
    expect(photoFileForId(12345)).toBe("photos/p12345.jpg");
  });
});

describe("validatePhotoRecords", () => {
  it("accepts a valid list and normalizes key order", () => {
    const shuffled = [
      { height: 600, width: 800, project: "gwii", file: "photos/p0001.jpg", id: 1, extra: true },
    ];
    const result = validatePhotoRecords(shuffled, known);
    expect(result).toEqual({ ok: true, records: [rec(1)] });
  });

  it("rejects non-arrays", () => {
    expect(validatePhotoRecords({}, known)).toMatchObject({ ok: false });
  });

  it("reports every problem: duplicate ids, unknown projects, wrong file names, bad sizes", () => {
    const result = validatePhotoRecords(
      [
        rec(1),
        rec(1),
        rec(2, "nope"),
        { ...rec(3), file: "switch/x.jpg" },
        { ...rec(4), width: 0 },
        { id: -1 },
        "x",
      ],
      known,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problems.join("\n")).toMatch(/id 1\): duplicate id/);
    expect(result.problems.join("\n")).toMatch(/unknown project "nope"/);
    expect(result.problems.join("\n")).toMatch(/file must be "photos\/p0003.jpg"/);
    expect(result.problems.join("\n")).toMatch(/id 4\): width\/height/);
    expect(result.problems.join("\n")).toMatch(/invalid id/);
    expect(result.problems.join("\n")).toMatch(/Entry #7 is not an object/);
  });
});

describe("groupByProject", () => {
  it("groups by project order and keeps each project's display order", () => {
    const mixed = [rec(5, "gboy"), rec(1), rec(9, "other"), rec(4, "gboy"), rec(2)];
    expect(groupByProject(mixed, known).map((r) => r.id)).toEqual([1, 2, 5, 4, 9]);
  });
});

describe("formatPhotosJson", () => {
  it("writes one photo per line and parses back to the same data", () => {
    const text = formatPhotosJson([rec(1), rec(2, "gboy")]);
    expect(text).toBe(
      '[\n  {"id":1,"file":"photos/p0001.jpg","project":"gwii","width":800,"height":600},\n' +
        '  {"id":2,"file":"photos/p0002.jpg","project":"gboy","width":800,"height":600}\n]\n',
    );
    expect(JSON.parse(text)).toEqual([rec(1), rec(2, "gboy")]);
    expect(formatPhotosJson([])).toBe("[]\n");
  });
});
