import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** Minimal fake document: records appended scripts so tests can fire their load/error events. */
function fakeDocument() {
  const scripts: { src: string; async: boolean; fire: (type: "load" | "error") => void }[] = [];
  const doc = {
    createElement: () => {
      const handlers: Record<string, () => void> = {};
      const el = {
        src: "",
        async: false,
        addEventListener: (type: string, fn: () => void) => (handlers[type] = fn),
        fire: (type: "load" | "error") => handlers[type]?.(),
      };
      return el;
    },
    head: { append: (el: (typeof scripts)[number]) => scripts.push(el) },
  };
  return { doc: doc as unknown as Document, scripts };
}

const fakeTurnstile = { render: vi.fn(), reset: vi.fn(), getResponse: vi.fn() };

describe("loadTurnstile", () => {
  beforeEach(() => {
    vi.resetModules(); // fresh module-level cache per test
    vi.stubGlobal("window", {});
  });
  afterEach(() => vi.unstubAllGlobals());

  it("injects the script once and shares the result between callers", async () => {
    const { loadTurnstile, TURNSTILE_SCRIPT_URL } = await import("./turnstile");
    const { doc, scripts } = fakeDocument();
    const first = loadTurnstile(doc);
    const second = loadTurnstile(doc);
    expect(scripts).toHaveLength(1);
    expect(scripts[0]!.src).toBe(TURNSTILE_SCRIPT_URL);
    expect(scripts[0]!.async).toBe(true);
    (window as Window).turnstile = fakeTurnstile;
    scripts[0]!.fire("load");
    await expect(first).resolves.toBe(fakeTurnstile);
    await expect(second).resolves.toBe(fakeTurnstile);
  });

  it("uses an already-loaded API without injecting anything", async () => {
    const { loadTurnstile } = await import("./turnstile");
    const { doc, scripts } = fakeDocument();
    (window as Window).turnstile = fakeTurnstile;
    await expect(loadTurnstile(doc)).resolves.toBe(fakeTurnstile);
    expect(scripts).toHaveLength(0);
  });

  it("allows a retry after the script fails to load", async () => {
    const { loadTurnstile } = await import("./turnstile");
    const { doc, scripts } = fakeDocument();
    const failed = loadTurnstile(doc);
    scripts[0]!.fire("error");
    await expect(failed).rejects.toThrow(/failed to load/);
    void loadTurnstile(doc);
    expect(scripts).toHaveLength(2);
  });
});
