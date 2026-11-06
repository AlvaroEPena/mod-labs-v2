import { describe, expect, it } from "vitest";
import {
  buildSql,
  DATABASE,
  describeOutcome,
  parseArgs,
  wranglerArgs,
} from "../../scripts/reviews-admin.mjs";

const NOW = Date.UTC(2026, 10, 5, 12);

describe("parseArgs", () => {
  it("reads approve/delete, a positive id, and targets production unless --local", () => {
    expect(parseArgs(["approve", "12"])).toEqual({ action: "approve", id: 12, target: "remote" });
    expect(parseArgs(["delete", "7", "--local"])).toEqual({ action: "delete", id: 7, target: "local" });
    expect(parseArgs(["--remote", "delete", "7"])).toEqual({ action: "delete", id: 7, target: "remote" });
  });

  it.each([
    [[]],
    [["publish", "1"]],
    [["approve"]],
    [["approve", "0"]],
    [["approve", "-1"]],
    [["approve", "01"]],
    [["approve", "1.5"]],
    [["approve", "1e3"]],
    [["approve", "12abc"]],
    [["approve", "1; DROP TABLE reviews"]],
    [["approve", "1 OR 1=1"]],
    [["approve", "1".repeat(16)]],
    [["approve", "1", "2"]],
    [["approve", "1", "--force"]],
    [["approve", "1", "--local", "--remote"]],
  ])("refuses %j", (argv) => {
    expect(parseArgs(argv)).toEqual({ error: expect.any(String) });
  });
});

describe("buildSql", () => {
  it("publishes only a pending row, and deletes in any state, reporting changed ids", () => {
    expect(buildSql({ action: "approve", id: 12 }, NOW)).toBe(
      `UPDATE reviews SET status = 'approved', approved_at = ${NOW} WHERE id = 12 AND status = 'pending' RETURNING id`,
    );
    expect(buildSql({ action: "delete", id: 12 }, NOW)).toBe(
      "DELETE FROM reviews WHERE id = 12 RETURNING id",
    );
  });

  it("refuses anything but whole numbers", () => {
    expect(() => buildSql({ action: "delete", id: Number.NaN }, NOW)).toThrow();
    expect(() => buildSql({ action: "delete", id: 0 }, NOW)).toThrow();
    expect(() => buildSql({ action: "approve", id: 1 }, 1.5)).toThrow();
  });
});

describe("wranglerArgs", () => {
  it("runs one --command against the reviews database, as JSON", () => {
    const sql = "DELETE FROM reviews WHERE id = 3 RETURNING id";
    expect(wranglerArgs({ action: "delete", id: 3, target: "remote" }, sql)).toEqual([
      "d1",
      "execute",
      DATABASE,
      "--remote",
      "--json",
      "--command",
      sql,
    ]);
    expect(wranglerArgs({ action: "delete", id: 3, target: "local" }, sql)).toContain("--local");
  });
});

describe("describeOutcome", () => {
  const approve = { action: "approve", id: 12, target: "remote" } as const;
  it("reports a change only when the statement returned the row", () => {
    expect(describeOutcome(approve, [{ results: [{ id: 12 }], success: true }])).toMatchObject({ ok: true });
    expect(describeOutcome(approve, [{ results: [], success: true }])).toEqual({
      ok: false,
      message: expect.stringContaining("Nothing changed"),
    });
    expect(describeOutcome(approve, undefined)).toMatchObject({ ok: false });
    expect(describeOutcome(approve, [{}])).toMatchObject({ ok: false });
  });
});
