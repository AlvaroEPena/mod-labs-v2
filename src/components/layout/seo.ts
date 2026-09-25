import { site } from "../../data/site";
import { services } from "../../data/services";

/** LocalBusiness JSON-LD (no street address: Seattle service area only). */
export function localBusinessLd(siteUrl: string) {
  return {
    "@context": "https://schema.org",
    "@type": "LocalBusiness",
    "@id": `${siteUrl}/#business`,
    name: site.name,
    description: site.description,
    url: `${siteUrl}/`,
    image: `${siteUrl}/og.png`,
    logo: `${siteUrl}/apple-touch-icon.png`,
    priceRange: "$$",
    address: { "@type": "PostalAddress", addressLocality: site.location.city, addressRegion: site.location.region, addressCountry: site.location.country },
    areaServed: { "@type": "City", name: "Seattle" },
    makesOffer: services.map((s) => ({
      "@type": "Offer",
      price: s.price,
      priceCurrency: "USD",
      itemOffered: { "@type": "Service", name: s.name, description: s.summary },
    })),
  };
}

/** Safe JSON for <script type="application/ld+json"> */
export const ldJson = (data: unknown) => JSON.stringify(data).replace(/</g, "\\u003c");
