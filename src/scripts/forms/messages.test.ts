import { describe, expect, it } from "vitest";
import { bookSchema, formDataToObject } from "../../lib/forms/schema";
import { errorCopy, fieldErrorsFromIssues, outcomeFromQuery, outcomeFromResponse, successCopy, summaryText } from "./messages";

describe("outcomeFromResponse", () => {
  it("maps ok:true to the success copy", () => {
    expect(outcomeFromResponse(200, { ok: true, message: "sent" })).toEqual({ kind: "success", message: successCopy });
  });

  it("passes validation fieldErrors through (including _form and photos)", () => {
    const fieldErrors = { email: ["Please enter a valid email address."], _form: ["Bad request."], photos: ["Too many."] };
    const o = outcomeFromResponse(400, { ok: false, error: "validation", fieldErrors });
    expect(o).toMatchObject({ kind: "error", code: "validation", fieldErrors });
  });

  it.each(["captcha", "rate_limited", "too_large", "not_configured", "server"] as const)("gives friendly copy for %s", (code) => {
    const o = outcomeFromResponse(500, { ok: false, error: code, message: "raw server text" });
    expect(o).toEqual({ kind: "error", code, message: errorCopy[code] });
  });

  it("tells people to DM when email isn't configured", () => {
    expect(errorCopy.not_configured).toMatch(/DM me/);
  });

  it.each([
    [413, "too_large"],
    [429, "rate_limited"],
    [403, "captcha"],
    [503, "not_configured"],
    [502, "server"],
    [404, "server"],
  ] as const)("falls back on HTTP %i when the body isn't JSON", (status, code) => {
    expect(outcomeFromResponse(status, null)).toMatchObject({ kind: "error", code });
  });
});

describe("outcomeFromQuery (no-JS 303 round trip)", () => {
  it("returns null without status params", () => {
    expect(outcomeFromQuery("?build=gwii")).toBeNull();
  });
  it("reads ?sent=1", () => {
    expect(outcomeFromQuery("?sent=1")?.kind).toBe("success");
  });
  it("reads every error code and treats unknown codes as server errors", () => {
    for (const code of ["validation", "captcha", "too_large", "rate_limited", "not_configured", "server"]) {
      expect(outcomeFromQuery(`?error=${code}`)).toMatchObject({ kind: "error", code });
    }
    expect(outcomeFromQuery("?error=<script>")).toMatchObject({ kind: "error", code: "server" });
  });
});

describe("fieldErrorsFromIssues + summaryText", () => {
  it("groups zod issues by top-level field with the shared schema", () => {
    const fd = new FormData();
    fd.set("name", "A");
    fd.set("email", "nope");
    fd.set("delivery", "Local drop-off (Seattle)");
    fd.set("message", "short");
    const r = bookSchema.safeParse(formDataToObject(fd));
    expect(r.success).toBe(false);
    if (r.success) return;
    const errs = fieldErrorsFromIssues(r.error.issues);
    expect(Object.keys(errs).sort()).toEqual(["consent", "email", "message", "name", "services"]);
    expect(summaryText(errs)).toMatch(/^5 fields need attention: /);
  });

  it("collapses nested paths and de-duplicates messages", () => {
    const errs = fieldErrorsFromIssues([
      { path: ["services", 0], message: "Bad option" },
      { path: ["services", 1], message: "Bad option" },
      { path: [], message: "Whole form" },
    ]);
    expect(errs).toEqual({ services: ["Bad option"], _form: ["Whole form"] });
    expect(summaryText(errs)).toBe("Whole form 1 field needs attention: Service.");
  });

  it("uses the _form message alone when no field is flagged", () => {
    expect(summaryText({ _form: ["Try again later."] })).toBe("Try again later.");
  });
});

describe("honeypot errors are never shown", () => {
  it("drops hp / hp_7f3 keys and returns null when nothing else is left", async () => {
    const { withoutHoneypot } = await import("./messages");
    expect(withoutHoneypot({ hp: ["x"], email: ["bad"] })).toEqual({ email: ["bad"] });
    expect(withoutHoneypot({ hp_7f3: ["x"] })).toBeNull();
  });
  it("turns a server validation error that only flags the honeypot into a generic error", () => {
    const o = outcomeFromResponse(400, { ok: false, error: "validation", fieldErrors: { hp: ["Must be empty"] } });
    expect(o).toMatchObject({ kind: "error", code: "server" });
    expect("fieldErrors" in o && o.fieldErrors).toBeFalsy();
  });
});
