/**
 * Gallery categories and projects (pure data, no imports) so both the Astro site and the local
 * photo admin (`admin/`, plain Node) can read them. Re-exported from `gallery.ts`.
 */
export const categorySlugs = ["switch", "xbox", "playstation", "custom", "repairs"] as const;
export type CategorySlug = (typeof categorySlugs)[number];

export type Category = { slug: CategorySlug; title: string; short: string; blurb: string };

export const categories: Category[] = [
  { slug: "switch", title: "Nintendo Switch Modchips", short: "Switch", blurb: "OLED (Kamikaze), V1/V2 and Lite installs, from the microscope to the finished console." },
  { slug: "xbox", title: "Xbox 360 RGH & Modchips", short: "Xbox 360", blurb: "Phat RGH 1.2 with Matrix/Ace chips and slim RGH3. Clean wire routing, Kapton and all." },
  { slug: "playstation", title: "PlayStation", short: "PlayStation", blurb: "PS4 internal PPPwn installs and controller work." },
  { slug: "custom", title: "Custom Builds", short: "Custom", blurb: "Portable Wiis, the Wii Miicro, and RGB and clear-shell Xboxes: one-off builds from scratch." },
  { slug: "repairs", title: "Repairs & Electronics", short: "Repairs", blurb: "Trace repair, port replacement, BIOS recovery: board-level fixes beyond consoles." },
];

export type ProjectVideo = {
  /** public path, e.g. "/media/halo-xbox.mp4" (files live in public/media/) */
  src: string;
  /** accessible name + caption */
  title: string;
  /** photo id to use as the poster; defaults to the project's hand-picked poster or cover */
  posterId?: number;
};

export type Project = {
  slug: string;
  title: string;
  category: CategorySlug;
  caption: string;
  /** Vetted videos, shown in their own row above the project's photos (in this order). */
  videos?: ProjectVideo[];
  /** links to a commission build on /builds */
  build?: "gwii" | "wii-miicro";
};

/** Write-ups carried over from the old site (captions lightly edited), plus new projects. Order = display order. */
export const projects: Project[] = [
  { slug: "gwii", title: "GWii: Portable Handheld Wii", category: "custom", build: "gwii",
    caption: "A real Wii motherboard trimmed down and built into a handheld: native Wii + GameCube, built-in speakers, USB-C PD charging, battery and temperature monitoring. Available as a commission." },
  { slug: "wii-miicro", title: "Wii Miicro Deluxe", category: "custom", build: "wii-miicro",
    caption: "An ultra-compact, modernized real Wii in a pink-to-blue fade shell: HDMI out, USB-C PD power, relocated MX chip and Bluetooth. Available as a commission." },
  { slug: "gboy", title: "Portable Handheld Wii (G-boy)", category: "custom",
    caption: "Transformed a Wii into a portable handheld by reducing the board size by 70% with custom, compact, modular components: GameCube controller emulation, integrated speakers, amp, screen, internal memory and power management." },
  { slug: "halo-xbox", title: "Custom Halo 4 RGH + RGB Xbox 360", category: "custom",
    videos: [{ src: "/media/halo-xbox.mp4", title: "Custom Halo 4 Xbox 360 RGB lighting" }],
    caption: "A Halo 4 edition Xbox 360 with RGH and a fully custom RGB layout glowing through the clear shell. It has a Bluetooth RGB controller that connects to phones, a sound chip flashed to R2-D2, and swapped ring-of-light LEDs." },
  { slug: "rgh3-compilation", title: "Compilation of RGH3", category: "xbox",
    caption: "A ton of RGH3 installs on slims. Dozens more went unphotographed :)" },
  { slug: "phat-matrix", title: "Phat Xbox 360 Modchip Install", category: "xbox",
    caption: "A Matrix modchip being installed on a phat Xbox 360." },
  { slug: "slim-ace-srgh", title: "Slim Xbox 360 Modchip Install", category: "xbox",
    caption: "Ace modchip + S-RGH installed to save a customer's failed RGH3 attempt." },
  { slug: "xbox-misc", title: "More Xbox 360 Work", category: "xbox",
    caption: "Cleanups, repastes and finished consoles ready to go home." },
  { slug: "switch-oled-kamikaze", title: "Switch OLED Kamikaze", category: "switch",
    caption: "One of my Kamikaze modchip installs on an OLED Switch, along with a new housing and joy-con shells." },
  { slug: "switch-misc", title: "Switch Installs", category: "switch",
    caption: "V1, V2, Lite and OLED installs. Precision work under the microscope, then a clean reassembly." },
  { slug: "ps4-pppwn", title: "PS4 Internal PPPwn", category: "playstation",
    caption: "An internal Luckfox Pico Mini runs PPPwn without anything connected externally." },
  { slug: "playstation-misc", title: "More PlayStation", category: "playstation",
    caption: "Board work and accessories." },
  { slug: "ps4-controller-trace", title: "PS4 Controller Trace Repair", category: "repairs",
    caption: "These traces were damaged by someone's attempt to remove the soldered joysticks. Repaired, and the controller works perfectly." },
  { slug: "blue-yeti-usb", title: "Blue Yeti USB Port Replacement", category: "repairs",
    caption: "Helped a friend out and replaced a very broken USB port (look at the pins in the photo)." },
  { slug: "lenovo-bios", title: "Lenovo Supervisor BIOS Password Bypass", category: "repairs",
    caption: "Installing a new OS on an old laptop with a forgotten BIOS password: used a Pi Pico running Pico-Serprog and the Flashrom CLI to dump, patch and flash the BIOS." },
  { slug: "repairs-misc", title: "More Repairs", category: "repairs", caption: "Controllers, boards and odds and ends." },
];
