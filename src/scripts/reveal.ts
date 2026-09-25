/**
 * Scroll-reveal fallback (~0.4 KB). Only active when the inline head script set html.io-reveal,
 * i.e. the browser lacks CSS scroll-driven animations and the user allows motion.
 */
const root = document.documentElement;
if (root.classList.contains("io-reveal")) {
  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (e.isIntersecting) {
          e.target.classList.add("is-in");
          io.unobserve(e.target);
        }
      }
    },
    { rootMargin: "0px 0px -8% 0px", threshold: 0.08 },
  );
  document.querySelectorAll<HTMLElement>(".reveal, .reveal-stagger").forEach((el) => {
    if (el.classList.contains("reveal-stagger")) {
      Array.from(el.children).forEach((c, i) => (c as HTMLElement).style.setProperty("--d", `${Math.min(i, 8) * 70}ms`));
    }
    io.observe(el);
  });
}
