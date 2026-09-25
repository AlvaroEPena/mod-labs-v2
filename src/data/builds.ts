/** Custom build commissions (made to order). Content from Al's Marketplace listings; game preloads intentionally omitted. */
export type Build = {
  slug: BuildSlug;
  name: string;
  price: number;
  tagline: string;
  description: string;
  features: { title: string; detail: string }[];
  included: string[];
  notIncluded: string[];
  /** gallery project slug that holds this build's photos */
  project: string;
};

export const buildSlugs = ["gwii", "wii-miicro"] as const;
export type BuildSlug = (typeof buildSlugs)[number];

export const builds: Build[] = [
  {
    slug: "gwii",
    name: "GWii Portable Handheld Wii",
    price: 900,
    tagline: "The full Wii experience in your hands. Real hardware, not emulation.",
    description:
      "A genuine Wii motherboard, trimmed with modern techniques and built into a handheld. It plays Wii and GameCube titles natively with flawless compatibility. Every GWii is hand-crafted and takes a long time to build.",
    features: [
      { title: "Native Wii hardware", detail: "Plays Wii and GameCube natively. No emulation, no compatibility lists." },
      { title: "USB-C PD charging", detail: "Modern fast charging with Power Delivery support." },
      { title: "128GB storage", detail: "Internal storage, upgradeable via microSD." },
      { title: "Smart USB switching", detail: "Plug into a PC to manage files instantly. No need to pull the storage." },
      { title: "VGA-driven display", detail: "Crisp, sharp image on the built-in screen: the best quality possible." },
      { title: "Built-in speakers", detail: "Clear audio out of the box, plus a 3.5mm headphone jack." },
      { title: "On-device controls", detail: "Volume and screen controls built in." },
      { title: "Battery monitoring", detail: "Software battery indicator plus LED charge status." },
      { title: "Temperature readout", detail: "Integrated monitoring for safe, reliable operation." },
    ],
    included: ["GWii handheld console"],
    notIncluded: [],
    project: "gwii",
  },
  {
    slug: "wii-miicro",
    name: "Wii Miicro Deluxe",
    price: 450,
    tagline: "A real Wii, shrunk into an ultra-compact, modernized console.",
    description:
      "Built from scratch in a pink-to-blue fade shell with a tiny footprint and modern output. It's a great party machine: plug and play anywhere. Hours of micro-soldering, board trimming, chip relocation and tuning go into every one.",
    features: [
      { title: "HDMI output", detail: "VGA patches + an analog-to-HDMI converter for a cleaner, sharper image than the original Wii." },
      { title: "USB-C PD power", detail: "Runs on standard USB-C PD (5V / 15W minimum to boot). 12V PD recommended to power a sensor bar." },
      { title: "128GB USB storage", detail: "Included 128GB USB drive for storage." },
      { title: "MX chip relocation", detail: "Timekeeping (RTC) works for games that need it." },
      { title: "Bluetooth relocation", detail: "Wiimotes pair normally. No quirks." },
      { title: "Ultra-compact", detail: "Light, tiny and extremely portable." },
    ],
    included: ["Wii Miicro Deluxe console", "20W USB-C PD power brick", "128GB USB drive"],
    notIncluded: ["Controllers", "Cables", "Sensor bar"],
    project: "wii-miicro",
  },
];

export const getBuild = (slug: string) => builds.find((b) => b.slug === slug);
