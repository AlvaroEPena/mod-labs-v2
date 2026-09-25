export type Platform = "xbox" | "switch" | "playstation" | "other";

export type Service = {
  id: ServiceId;
  name: string;
  platform: Platform;
  /** USD, whole dollars. null = priced by quote */
  price: number | null;
  summary: string;
  includes: string[];
  featured?: boolean;
};

export const serviceIds = ["xbox-360-rgh", "switch-oled", "switch-v1-v2", "switch-lite"] as const;
export type ServiceId = (typeof serviceIds)[number] | "ps4-pppwn" | "repair" | "custom-shell";

/** Priced mod services (bookable on /book). */
export const services: Service[] = [
  {
    id: "xbox-360-rgh",
    name: "Xbox 360 RGH",
    platform: "xbox",
    price: 100,
    summary:
      "Phat RGH 1.2 (modchip) and slim RGH3, plus other RGH variants on request, all at one easy price.",
    includes: [
      "Modchip (where applicable)",
      "Deep clean + fresh thermal paste",
      "Software setup: Aurora dashboard + homebrew essentials",
      "Walkthrough of how to use everything",
      "Ask about games",
    ],
    featured: true,
  },
  {
    id: "switch-oled",
    name: "Switch OLED",
    platform: "switch",
    price: 160,
    summary: "Modchip install using the Kamikaze method: a direct DAT0 point that won't come undone.",
    includes: [
      "Modchip",
      "Kamikaze install (direct DAT0 point)",
      "Deep clean + fresh thermal paste",
      "Software setup: emuMMC partition + homebrew",
      "Ask about games",
    ],
    featured: true,
  },
  {
    id: "switch-v1-v2",
    name: "Switch V1 / V2",
    platform: "switch",
    price: 120,
    summary: "The standard modchip path for classic Switch models.",
    includes: ["Modchip", "Deep clean + fresh thermal paste", "Software setup: emuMMC partition + homebrew", "Ask about games"],
    featured: true,
  },
  {
    id: "switch-lite",
    name: "Switch Lite",
    platform: "switch",
    price: 140,
    summary: "Modchip install for the portable form factor.",
    includes: ["Modchip", "Deep clean + fresh thermal paste", "Software setup: emuMMC partition + homebrew", "Ask about games"],
    featured: true,
  },
];

/** Quote-based work (shown on /services, requested via /quote). */
export const quoteServices: Service[] = [
  {
    id: "ps4-pppwn",
    name: "PS4 internal PPPwn",
    platform: "playstation",
    price: null,
    summary: "An internal Luckfox Pico Mini runs PPPwn automatically. Nothing hanging off the back of your console.",
    includes: ["Internal install", "Clean wiring", "Setup + walkthrough"],
  },
  {
    id: "repair",
    name: "Electronics repair",
    platform: "other",
    price: null,
    summary: "Port and joystick replacements, trace repair, board-level diagnostics: consoles, controllers and beyond.",
    includes: ["Diagnosis", "Upfront quote before any work", "Micro-soldering + rework"],
  },
  {
    id: "custom-shell",
    name: "Custom shells & RGB",
    platform: "other",
    price: null,
    summary: "New housings, joy-con shells, RGB lighting and one-off aesthetic mods.",
    includes: ["Shell swap / lighting install", "Parts sourcing help", "Clean, reversible where possible"],
  },
];

export const formatPrice = (price: number | null) => (price === null ? "Quote" : `$${price}`);
