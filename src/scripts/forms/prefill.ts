/**
 * Deep links that preselect a form option:
 *  - /book?service=switch-oled ticks that service (input[data-service-id])
 *  - /quote?build=gwii selects the build's request type (map in the form's data-build-map)
 * Unknown values select nothing. A change event is fired so dependent UI (e.g. the /book total) updates.
 */
import type { FormKind } from "./kinds";

const changed = (el: HTMLElement) => el.dispatchEvent(new Event("change", { bubbles: true }));

export function prefillFromUrl(form: HTMLFormElement, kind: FormKind, params: URLSearchParams) {
  if (kind === "book") {
    const id = params.get("service");
    const box = id ? form.querySelector<HTMLInputElement>(`input[data-service-id="${CSS.escape(id)}"]`) : null;
    if (box) {
      box.checked = true;
      changed(box);
    }
    return;
  }
  if (kind === "quote") {
    const build = params.get("build");
    const map = JSON.parse(form.dataset.buildMap ?? "{}") as Record<string, string>;
    const select = form.querySelector<HTMLSelectElement>('select[name="requestType"]');
    if (build && select && map[build]) {
      select.value = map[build];
      changed(select);
    }
  }
}
