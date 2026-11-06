/**
 * JSON-LD builders (schema.org). Pure functions of the content data: pages pass the absolute site URL
 * (and anything that needs the asset pipeline, like image URLs), so these stay unit-testable.
 */
import { site } from "../../data/site";
import { services, quoteServices, type Service } from "../../data/services";
import type { Build } from "../../data/builds";
import type { Faq } from "../../data/faq";

const CONTEXT = "https://schema.org";
const businessId = (siteUrl: string) => `${siteUrl}/#business`;

/** The business as a provider/seller reference (the full LocalBusiness node lives on the home page). */
const businessRef = (siteUrl: string) => ({
  "@type": "LocalBusiness",
  "@id": businessId(siteUrl),
  name: site.name,
  url: `${siteUrl}/`,
});

/** LocalBusiness JSON-LD (no street address: Seattle service area only). */
export function localBusinessLd(siteUrl: string) {
  return {
    "@context": CONTEXT,
    "@type": "LocalBusiness",
    "@id": businessId(siteUrl),
    name: site.name,
    description: site.description,
    url: `${siteUrl}/`,
    image: `${siteUrl}/og.png`,
    logo: `${siteUrl}/apple-touch-icon.png`,
    priceRange: "$$",
    address: {
      "@type": "PostalAddress",
      addressLocality: site.location.city,
      addressRegion: site.location.region,
      addressCountry: site.location.country,
    },
    areaServed: { "@type": "City", name: site.location.city },
    makesOffer: services.map((s) => ({
      "@type": "Offer",
      price: s.price,
      priceCurrency: "USD",
      itemOffered: { "@type": "Service", name: s.name, description: s.summary },
    })),
  };
}

/** A trail step. `path` is site-relative ("/gallery"); the home step is added automatically. */
export type Crumb = { name: string; path: string };

export const withHome = (crumbs: readonly Crumb[]): Crumb[] => [{ name: "Home", path: "/" }, ...crumbs];

export function breadcrumbLd(siteUrl: string, crumbs: readonly Crumb[]) {
  return {
    "@context": CONTEXT,
    "@type": "BreadcrumbList",
    itemListElement: withHome(crumbs).map((c, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: c.name,
      item: `${siteUrl}${c.path === "/" ? "/" : c.path}`,
    })),
  };
}

const serviceNode = (siteUrl: string, s: Service) => ({
  "@type": "Service",
  name: s.name,
  description: s.summary,
  serviceType: s.price === null ? "Electronics repair and custom work" : "Console modding",
  url: `${siteUrl}/services#${s.id}`,
  provider: businessRef(siteUrl),
  areaServed: { "@type": "City", name: site.location.city },
  ...(s.price === null
    ? {}
    : {
        offers: {
          "@type": "Offer",
          price: s.price,
          priceCurrency: "USD",
          url: `${siteUrl}/book?service=${s.id}`,
          availability: "https://schema.org/InStock",
        },
      }),
});

/** Every service on /services: priced mods carry an Offer (USD), quote-only work doesn't. */
export function servicesLd(siteUrl: string) {
  return { "@context": CONTEXT, "@graph": [...services, ...quoteServices].map((s) => serviceNode(siteUrl, s)) };
}

/** The commission builds on /builds as Products with a made-to-order Offer. `images` maps slug → absolute URL. */
export function buildsLd(siteUrl: string, builds: readonly Build[], images: Readonly<Record<string, string>> = {}) {
  return {
    "@context": CONTEXT,
    "@graph": builds.map((b) => ({
      "@type": "Product",
      name: b.name,
      description: b.description,
      url: `${siteUrl}/builds#${b.slug}`,
      ...(images[b.slug] ? { image: [images[b.slug]] } : {}),
      brand: { "@type": "Brand", name: site.name },
      offers: {
        "@type": "Offer",
        price: b.price,
        priceCurrency: "USD",
        url: `${siteUrl}/quote?build=${b.slug}`,
        availability: "https://schema.org/MadeToOrder",
        seller: businessRef(siteUrl),
      },
    })),
  };
}

export function faqLd(faqs: readonly Faq[]) {
  return {
    "@context": CONTEXT,
    "@type": "FAQPage",
    mainEntity: faqs.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })),
  };
}

/** Safe JSON for <script type="application/ld+json"> */
export const ldJson = (data: unknown) => JSON.stringify(data).replace(/</g, "\\u003c");
