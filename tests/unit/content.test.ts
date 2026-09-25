import { describe, expect, it } from "vitest";
import { builds } from "../../src/data/builds";
import { faqs } from "../../src/data/faq";
import { categories, photos, photosFor, projects } from "../../src/data/gallery";
import { services } from "../../src/data/services";
import { bookSchema, quoteSchema, buildRequestType } from "../../src/lib/forms/schema";

describe("content integrity", () => {
  it("keeps the approved prices", () => {
    expect(Object.fromEntries(services.map((s) => [s.id, s.price]))).toEqual({
      "xbox-360-rgh": 100, "switch-oled": 160, "switch-v1-v2": 120, "switch-lite": 140,
    });
    expect(Object.fromEntries(builds.map((b) => [b.slug, b.price]))).toEqual({ gwii: 900, "wii-miicro": 450 });
  });

  it("has every exported photo resolvable and categorized", () => {
    expect(photos.length).toBe(187);
    const cats = new Set(categories.map((c) => c.slug));
    for (const p of photos) expect(cats.has(p.category)).toBe(true);
  });

  it("gives every project at least one photo and every build a project", () => {
    for (const p of projects) expect(photosFor(p.slug).length, p.slug).toBeGreaterThan(0);
    for (const b of builds) expect(projects.some((p) => p.slug === b.project)).toBe(true);
  });

  it("never mentions game libraries or preloaded games in customer-facing copy", () => {
    const copy = JSON.stringify({ services, builds, projects });
    expect(copy).not.toMatch(/game(s)? (list|archive|librar)|preload|curated .*titles|selection of games/i);
  });
});

describe("owner-confirmed details", () => {
  it("ships every commission build with a USB-C PD power brick but no cable", () => {
    for (const b of builds) {
      expect(b.included.some((i) => /USB-C PD power brick/.test(i)), b.slug).toBe(true);
      expect(b.notIncluded, b.slug).toContain("USB-C cable");
    }
  });

  it("tells Switch customers to bring a genuine 256GB+ microSD card", () => {
    const bring = faqs.find((f) => f.q === "What do I need to bring?");
    expect(bring?.a).toMatch(/256GB/);
    expect(bring?.a).toMatch(/reputable seller/);
  });
});

describe("form schemas", () => {
  const base = { name: "Al Tester", email: "al@example.com", phone: "", delivery: "Local drop-off (Seattle)",
    message: "My OLED switch needs the Kamikaze install please.", consent: "yes", hp: "" };

  it("accepts a valid booking and rejects an empty service list", () => {
    expect(bookSchema.safeParse({ ...base, services: ["Switch OLED modchip, Kamikaze ($160)"] }).success).toBe(true);
    expect(bookSchema.safeParse({ ...base, services: [] }).success).toBe(false);
  });

  it("rejects the honeypot and maps build slugs to request types", () => {
    expect(quoteSchema.safeParse({ ...base, requestType: buildRequestType.gwii }).success).toBe(true);
    expect(quoteSchema.safeParse({ ...base, requestType: "General question", hp: "spam" }).success).toBe(false);
  });
});
