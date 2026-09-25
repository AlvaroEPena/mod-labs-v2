/**
 * Gallery lightbox. PhotoSwipe (core + CSS, ~19 KB gz) is NOT in the page bundle: it is fetched
 * on first intent (hover/touch/focus on a tile) and opened on click. Tiles are plain links to the
 * 1600px WebP, so everything still works without JS.
 * Swipe, pinch-zoom, keyboard arrows, Esc and focus return come from PhotoSwipe; we add
 * "back button closes the lightbox" via a history entry.
 */
import type PhotoSwipeType from "photoswipe";
import type { SlideData } from "photoswipe";

type PswpCtor = typeof PhotoSwipeType;
let loader: Promise<PswpCtor> | undefined;

const load = () =>
  (loader ??= Promise.all([import("photoswipe"), import("photoswipe/style.css")]).then(([m]) => m.default));

const TILE = "a[data-pswp-width]";

function slidesFor(gallery: Element): { slides: SlideData[]; links: HTMLAnchorElement[] } {
  const links = Array.from(gallery.querySelectorAll<HTMLAnchorElement>(TILE));
  const slides = links.map((a) => {
    const img = a.querySelector("img");
    return {
      src: a.href,
      width: Number(a.dataset.pswpWidth),
      height: Number(a.dataset.pswpHeight),
      alt: img?.alt ?? "",
      // show the already-loaded thumbnail instantly while the large image streams in
      msrc: img?.currentSrc || undefined,
      element: a,
    } satisfies SlideData;
  });
  return { slides, links };
}

async function open(gallery: Element, index: number) {
  const PhotoSwipe = await load();
  const { slides } = slidesFor(gallery);
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const pswp = new PhotoSwipe({
    dataSource: slides,
    index,
    bgOpacity: 0.94,
    showHideAnimationType: reduce ? "none" : "zoom",
    showAnimationDuration: 320,
    hideAnimationDuration: 260,
    closeTitle: "Close (Esc)",
    zoomTitle: "Zoom",
    arrowPrevTitle: "Previous photo",
    arrowNextTitle: "Next photo",
    errorMsg: "This photo couldn't be loaded.",
    returnFocus: true,
    padding: { top: 24, bottom: 24, left: 0, right: 0 },
  });

  // Back gesture / back button closes the lightbox instead of leaving the page.
  let closedByHistory = false;
  history.pushState({ pswp: true }, "");
  const onPop = () => {
    closedByHistory = true;
    pswp.close();
  };
  addEventListener("popstate", onPop);
  pswp.on("destroy", () => {
    removeEventListener("popstate", onPop);
    if (!closedByHistory && history.state?.pswp) history.back();
  });

  pswp.init();
}

function onClick(e: MouseEvent) {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  const link = (e.target as Element).closest<HTMLAnchorElement>(TILE);
  const gallery = link?.closest("[data-pswp-gallery]");
  if (!link || !gallery) return;
  e.preventDefault();
  const { links } = slidesFor(gallery);
  void open(gallery, Math.max(0, links.indexOf(link)));
}

const warm = (e: Event) => {
  if ((e.target as Element).closest?.(TILE)) void load();
};

document.addEventListener("click", onClick);
for (const type of ["pointerover", "touchstart", "focusin"] as const) {
  document.addEventListener(type, warm, { passive: true, once: false });
}
