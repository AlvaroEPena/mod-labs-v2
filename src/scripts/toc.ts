/**
 * Table-of-contents scrollspy for legal pages: the TOC link of the section being read gets
 * aria-current="location" (styled as a lit pad). "Being read" = the last section whose top has passed a
 * reading line at 35% of the viewport; at the very bottom of the page (where short last sections can't
 * reach that line) a section picked from the TOC wins. Recomputed when a section crosses the line
 * (IntersectionObserver) and on hashchange: no scroll listeners.
 * The TOC is a disclosure that ships closed (no layout shift on phones) and is opened here on wide
 * screens, where it sits in its own sticky column.
 */
const READING_LINE = 0.35;

const box = document.querySelector<HTMLDetailsElement>("details[data-toc]");
const sections = Array.from(document.querySelectorAll<HTMLElement>("[data-toc-section]"));
const links = new Map(
  Array.from(box?.querySelectorAll<HTMLAnchorElement>("a[href^='#']") ?? []).map((a) => [a.hash.slice(1), a]),
);

const wide = matchMedia("(min-width: 64rem)");
if (box && wide.matches) box.open = true;

function currentSection(): string | undefined {
  const line = innerHeight * READING_LINE;
  let current: string | undefined;
  for (const s of sections) if (s.getBoundingClientRect().top <= line) current = s.id;
  const picked = location.hash.slice(1);
  const atBottom = Math.ceil(innerHeight + scrollY) >= document.documentElement.scrollHeight - 2;
  return atBottom && links.has(picked) ? picked : current;
}

if (sections.length && links.size) {
  const mark = () => {
    const id = currentSection();
    links.forEach((a, key) => (key === id ? a.setAttribute("aria-current", "location") : a.removeAttribute("aria-current")));
  };
  const io = new IntersectionObserver(mark, { rootMargin: `0px 0px -${100 - READING_LINE * 100}% 0px` });
  sections.forEach((s) => io.observe(s));
  addEventListener("hashchange", mark);
  // phones: picking a section closes the disclosure so the text is in view
  box?.addEventListener("click", (e) => {
    if ((e.target as Element).closest("a") && !wide.matches) box.open = false;
  });
}
