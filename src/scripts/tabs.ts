/**
 * Progressive ARIA tabs for [data-tabs] (WAI-ARIA APG "tabs with automatic activation").
 * Server HTML shows every panel stacked (works without JS, and every panel is crawlable). This script
 * reveals the [data-tablist] (its buttons already carry role="tab" + aria-controls), turns the panels
 * into role="tabpanel", and shows one at a time:
 *  - click, or arrow keys / Home / End with roving tabindex (Up/Down too unless aria-orientation="horizontal")
 *  - a #hash pointing at a panel (e.g. /services#switch-lite) selects it on load and on hashchange
 *  - writes the active tab's box into --ind-x/--ind-w on the tablist so CSS can slide an indicator
 * The newly shown panel gets [data-entered] for one frame so CSS can play a (motion-gated) entrance.
 */
import { nextIndex } from "./tabs-keys";

function enhance(root: HTMLElement) {
  const tablist = root.querySelector<HTMLElement>("[data-tablist]");
  if (!tablist) return;
  const tabs = Array.from(tablist.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
  const panels = tabs.map((t) => document.getElementById(t.getAttribute("aria-controls") ?? ""));
  if (!tabs.length || panels.some((p) => !p)) return;
  const horizontalOnly = tablist.getAttribute("aria-orientation") === "horizontal";

  panels.forEach((p, i) => {
    p!.setAttribute("role", "tabpanel");
    p!.setAttribute("aria-labelledby", tabs[i].id);
    p!.tabIndex = 0;
  });
  tablist.hidden = false;
  root.dataset.tabsReady = "";

  const placeIndicator = (tab: HTMLElement) => {
    tablist.style.setProperty("--ind-x", `${tab.offsetLeft}px`);
    tablist.style.setProperty("--ind-y", `${tab.offsetTop}px`);
    tablist.style.setProperty("--ind-w", `${tab.offsetWidth}px`);
    tablist.style.setProperty("--ind-h", `${tab.offsetHeight}px`);
  };

  let current = -1;
  const select = (i: number, { focus = false } = {}) => {
    if (i === current) return;
    current = i;
    tabs.forEach((t, j) => {
      const on = j === i;
      t.setAttribute("aria-selected", String(on));
      t.tabIndex = on ? 0 : -1;
      panels[j]!.hidden = !on;
    });
    const panel = panels[i]!;
    panel.dataset.entered = "";
    requestAnimationFrame(() => requestAnimationFrame(() => delete panel.dataset.entered));
    placeIndicator(tabs[i]);
    if (focus) tabs[i].focus();
  };

  /** A #hash naming a panel selects it; the browser couldn't scroll to it while it was hidden, so we do. */
  const fromHash = () => {
    const i = panels.findIndex((p) => p && `#${p.id}` === location.hash);
    if (i < 0) return false;
    select(i);
    const smooth = matchMedia("(prefers-reduced-motion: no-preference)").matches;
    root.scrollIntoView({ block: "start", behavior: smooth ? "smooth" : "auto" });
    return true;
  };

  tabs.forEach((t, i) => t.addEventListener("click", () => select(i)));
  tablist.addEventListener("keydown", (e) => {
    const i = nextIndex(e.key, current, tabs.length, horizontalOnly);
    if (i === null) return;
    e.preventDefault();
    select(i, { focus: true });
  });
  addEventListener("hashchange", fromHash);
  new ResizeObserver(() => current >= 0 && placeIndicator(tabs[current])).observe(tablist);

  const initial = Math.max(0, tabs.findIndex((t) => t.getAttribute("aria-selected") === "true"));
  if (!fromHash()) select(initial);
}

document.querySelectorAll<HTMLElement>("[data-tabs]").forEach(enhance);
