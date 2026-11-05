/**
 * Icon registry: our short names → Phosphor icons (regular weight, MIT, @phosphor-icons/core).
 * Imported as raw SVG at build time, so only the icons listed here ship, inlined, with zero client JS.
 * Add an icon: import it below and give it a name in `icons`.
 */
import arrowRight from "@phosphor-icons/core/regular/arrow-right.svg?raw";
import arrowLeft from "@phosphor-icons/core/regular/arrow-left.svg?raw";
import check from "@phosphor-icons/core/regular/check.svg?raw";
import x from "@phosphor-icons/core/regular/x.svg?raw";
import plus from "@phosphor-icons/core/regular/plus.svg?raw";
import list from "@phosphor-icons/core/regular/list.svg?raw";
import cpu from "@phosphor-icons/core/regular/cpu.svg?raw";
import flask from "@phosphor-icons/core/regular/flask.svg?raw";
import lightning from "@phosphor-icons/core/regular/lightning.svg?raw";
import shieldCheck from "@phosphor-icons/core/regular/shield-check.svg?raw";
import clock from "@phosphor-icons/core/regular/clock.svg?raw";
import truck from "@phosphor-icons/core/regular/truck.svg?raw";
import mapPin from "@phosphor-icons/core/regular/map-pin.svg?raw";
import chat from "@phosphor-icons/core/regular/chat-circle-text.svg?raw";
import wrench from "@phosphor-icons/core/regular/wrench.svg?raw";
import sparkle from "@phosphor-icons/core/regular/sparkle.svg?raw";
import camera from "@phosphor-icons/core/regular/camera.svg?raw";
import upload from "@phosphor-icons/core/regular/upload-simple.svg?raw";
import eye from "@phosphor-icons/core/regular/eye.svg?raw";
import microscope from "@phosphor-icons/core/regular/microscope.svg?raw";
import thermometer from "@phosphor-icons/core/regular/thermometer-simple.svg?raw";
import hand from "@phosphor-icons/core/regular/hand.svg?raw";
import instagram from "@phosphor-icons/core/regular/instagram-logo.svg?raw";
import tiktok from "@phosphor-icons/core/regular/tiktok-logo.svg?raw";
import discord from "@phosphor-icons/core/regular/discord-logo.svg?raw";
import play from "@phosphor-icons/core/fill/play-fill.svg?raw";
import warning from "@phosphor-icons/core/regular/warning-circle.svg?raw";
import house from "@phosphor-icons/core/regular/house.svg?raw";
import image from "@phosphor-icons/core/regular/image.svg?raw";
import refresh from "@phosphor-icons/core/regular/arrow-clockwise.svg?raw";
import circuitry from "@phosphor-icons/core/regular/circuitry.svg?raw";
import packageIcon from "@phosphor-icons/core/regular/package.svg?raw";

const icons = {
  arrow: arrowRight,
  "arrow-left": arrowLeft,
  check,
  x,
  plus,
  menu: list,
  chip: cpu,
  flask,
  bolt: lightning,
  shield: shieldCheck,
  clock,
  truck,
  pin: mapPin,
  chat,
  wrench,
  sparkle,
  camera,
  upload,
  eye,
  microscope,
  thermo: thermometer,
  hand,
  instagram,
  tiktok,
  discord,
  play,
  alert: warning,
  home: house,
  image,
  refresh,
  circuit: circuitry,
  package: packageIcon,
} as const;

export type IconName = keyof typeof icons;

/** Inner markup of a Phosphor SVG (its paths), without the outer <svg> wrapper. */
export const iconBody = (name: IconName): string => icons[name].replace(/^[\s\S]*?<svg[^>]*>/, "").replace(/<\/svg>\s*$/, "");
