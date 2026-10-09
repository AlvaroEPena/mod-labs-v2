/**
 * Lazy Cloudflare Turnstile loader.
 *
 * Turnstile issues a token as soon as its widget renders. Rendering on page load meant every visitor
 * who only looked at /book or /quote got a token that was never verified, which inflates Cloudflare's
 * "siteverify isn't being called" warning and runs the challenge for people who never submit.
 * So the script loads once, on the first real interaction with a form, and is shared by every form
 * on the page.
 */
export const TURNSTILE_SCRIPT_URL = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

export type Turnstile = {
  render: (el: HTMLElement, opts: Record<string, unknown>) => string;
  reset: (id?: string) => void;
  getResponse: (id?: string) => string | undefined;
};

declare global {
  interface Window {
    turnstile?: Turnstile;
  }
}

let loading: Promise<Turnstile> | undefined;

/** Inject the Turnstile script once; resolves when `window.turnstile` is ready. */
export function loadTurnstile(doc: Document = document): Promise<Turnstile> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  loading ??= new Promise<Turnstile>((resolve, reject) => {
    const script = doc.createElement("script");
    script.src = TURNSTILE_SCRIPT_URL;
    script.async = true;
    script.addEventListener("load", () =>
      window.turnstile ? resolve(window.turnstile) : reject(new Error("Turnstile loaded without its API")),
    );
    script.addEventListener("error", () => {
      loading = undefined; // allow a retry on the next interaction
      reject(new Error("Turnstile script failed to load"));
    });
    doc.head.append(script);
  });
  return loading;
}

/** Events that mean a person has started using the form (keyboard, mouse or touch). */
export const FIRST_INTERACTION_EVENTS = ["focusin", "pointerdown", "input"] as const;
