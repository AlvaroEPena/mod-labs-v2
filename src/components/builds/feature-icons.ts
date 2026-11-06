/**
 * Presentation only: which Phosphor icon illustrates each build feature in the spec explorer, keyed by
 * the feature title in src/data/builds.ts. A renamed or new feature falls back to the chip icon, so
 * editing the data can never break the page.
 */
import type { IconName } from "../ui/icons";

const FEATURE_ICONS: Record<string, IconName> = {
  "Native Wii hardware": "chip",
  "USB-C PD charging": "bolt",
  "128GB storage": "hard-drive",
  "Smart USB switching": "usb",
  "VGA-driven display": "monitor",
  "Built-in speakers": "speaker",
  "On-device controls": "sliders",
  "Battery monitoring": "battery",
  "Temperature readout": "thermo",
  "HDMI output": "tv",
  "USB-C PD power": "bolt",
  "128GB USB storage": "usb",
  "MX chip relocation": "clock",
  "Bluetooth relocation": "bluetooth",
  "Ultra-compact": "cube",
};

export const featureIcon = (title: string): IconName => FEATURE_ICONS[title] ?? "chip";
