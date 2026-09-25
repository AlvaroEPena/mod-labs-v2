/** Enhances [data-carousel]: prev/next buttons + live counter over a native scroll-snap track. */

for (const root of document.querySelectorAll<HTMLElement>("[data-carousel]")) {
  const track = root.querySelector<HTMLElement>(".track");
  const slides = Array.from(root.querySelectorAll<HTMLElement>(".slide"));
  const prev = root.querySelector<HTMLButtonElement>("[data-prev]");
  const next = root.querySelector<HTMLButtonElement>("[data-next]");
  const out = root.querySelector<HTMLElement>("[data-index]");
  if (!track || !slides.length) continue;

  let current = 0;
  const update = (i: number) => {
    current = i;
    if (out) out.textContent = String(i + 1);
    if (prev) prev.disabled = i === 0;
    if (next) next.disabled = i === slides.length - 1;
  };
  update(0);

  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (e.isIntersecting && e.intersectionRatio >= 0.6) update(slides.indexOf(e.target as HTMLElement));
      }
    },
    { root: track, threshold: [0.6] },
  );
  slides.forEach((s) => io.observe(s));

  const go = (delta: number) => {
    const i = Math.min(slides.length - 1, Math.max(0, current + delta));
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const s = slides[i];
    track.scrollTo({ left: s.offsetLeft - (track.clientWidth - s.clientWidth) / 2, behavior: reduce ? "auto" : "smooth" });
  };
  prev?.addEventListener("click", () => go(-1));
  next?.addEventListener("click", () => go(1));
  track.addEventListener("keydown", (e) => {
    if (e.key === "ArrowRight") {
      e.preventDefault();
      go(1);
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      go(-1);
    }
  });
}
