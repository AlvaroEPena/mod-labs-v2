import { describe, expect, it } from "vitest";
import { breadcrumbLd, buildsLd, faqLd, ldJson, localBusinessLd, servicesLd } from "./seo";
import { builds } from "../../data/builds";
import { faqs } from "../../data/faq";
import { services } from "../../data/services";

const SITE = "https://modlabs.example";

describe("breadcrumbLd", () => {
  it("starts at Home and numbers absolute items in order", () => {
    const ld = breadcrumbLd(SITE, [
      { name: "Gallery", path: "/gallery" },
      { name: "Switch", path: "/gallery/switch" },
    ]);
    expect(ld["@type"]).toBe("BreadcrumbList");
    expect(ld.itemListElement.map((i) => [i.position, i.name, i.item])).toEqual([
      [1, "Home", `${SITE}/`],
      [2, "Gallery", `${SITE}/gallery`],
      [3, "Switch", `${SITE}/gallery/switch`],
    ]);
  });
});

describe("servicesLd", () => {
  it("gives every priced mod a USD Offer with its data price, and quote work none", () => {
    const graph = servicesLd(SITE)["@graph"];
    for (const s of services) {
      const node = graph.find((n) => n.name === s.name);
      expect(node?.offers).toMatchObject({ "@type": "Offer", price: s.price, priceCurrency: "USD" });
    }
    expect(graph.filter((n) => !("offers" in n)).length).toBeGreaterThan(0);
    expect(graph.every((n) => n["@type"] === "Service" && n.provider["@id"] === `${SITE}/#business`)).toBe(true);
  });
});

describe("buildsLd", () => {
  it("describes each build as a Product with a made-to-order USD Offer", () => {
    const graph = buildsLd(SITE, builds, { gwii: `${SITE}/gwii.webp` })["@graph"];
    expect(graph).toHaveLength(builds.length);
    for (const b of builds) {
      const node = graph.find((n) => n.name === b.name);
      expect(node?.["@type"]).toBe("Product");
      expect(node?.offers).toMatchObject({ price: b.price, priceCurrency: "USD", availability: "https://schema.org/MadeToOrder" });
    }
    expect(graph.find((n) => n.url.endsWith("#gwii"))?.image).toEqual([`${SITE}/gwii.webp`]);
  });
});

describe("faqLd + localBusinessLd", () => {
  it("lists every FAQ as a Question with an Answer", () => {
    const ld = faqLd(faqs);
    expect(ld.mainEntity).toHaveLength(faqs.length);
    expect(ld.mainEntity[0]).toMatchObject({ "@type": "Question", name: faqs[0].q, acceptedAnswer: { text: faqs[0].a } });
  });

  it("keeps the business in Seattle without a street address", () => {
    expect(JSON.stringify(localBusinessLd(SITE))).not.toMatch(/streetAddress/);
  });

  it("escapes < so JSON-LD can't close its script tag", () => {
    expect(ldJson({ a: "</script>" })).toBe('{"a":"\\u003c/script>"}');
  });
});
