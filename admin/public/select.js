// @ts-check
/**
 * Selection model (no DOM): a set of photo ids plus the anchor for Shift-click ranges. Selections
 * can span projects. `onChange` runs after every change so the UI can sync.
 */
import { idsBetween } from "./order.js";

/**
 * @param {() => void} onChange
 */
export function createSelection(onChange) {
  /** @type {Set<number>} */
  const selected = new Set();
  /** @type {number | null} last id clicked without Shift: the start of the next range */
  let anchor = null;

  const api = {
    /** @param {number} id */
    has: (id) => selected.has(id),
    get size() {
      return selected.size;
    },
    /**
     * Selected ids in the given display order (so moves keep the photos' relative order).
     * @param {readonly number[]} order
     */
    inOrder: (order) => order.filter((id) => selected.has(id)),

    /** @param {number} id */
    toggle(id) {
      if (selected.has(id)) selected.delete(id);
      else selected.add(id);
      anchor = id;
      onChange();
    },

    /**
     * Shift-click: select everything between the anchor and `id` within `order` (one project).
     * Without a usable anchor it behaves like a plain toggle.
     * @param {readonly number[]} order
     * @param {number} id
     */
    extendTo(order, id) {
      const range = anchor === null ? [] : idsBetween(order, anchor, id);
      if (range.length === 0) return api.toggle(id);
      for (const x of range) selected.add(x);
      onChange();
    },

    /**
     * @param {readonly number[]} ids
     * @param {boolean} on
     */
    setMany(ids, on) {
      for (const id of ids) {
        if (on) selected.add(id);
        else selected.delete(id);
      }
      onChange();
    },

    clear() {
      if (selected.size === 0) return;
      selected.clear();
      anchor = null;
      onChange();
    },

    /**
     * Forget ids that no longer exist (after a delete, restore or reload). Silent.
     * @param {Iterable<number>} validIds
     */
    prune(validIds) {
      const valid = new Set(validIds);
      for (const id of selected) if (!valid.has(id)) selected.delete(id);
      if (anchor !== null && !valid.has(anchor)) anchor = null;
    },
  };
  return api;
}

/** @typedef {ReturnType<typeof createSelection>} Selection */
