/**
 * Shared form contract. Used by the browser (client-side validation) and the Worker
 * (authoritative server-side validation). Change only via the orchestrator + spec §6.
 */
import { z } from "zod";

export const deliveryOptions = ["Local drop-off (Seattle)", "Mail-in (let's talk)"] as const;

export const bookServiceOptions = [
  "Xbox 360 RGH ($100)",
  "Switch OLED modchip, Kamikaze ($160)",
  "Switch V1/V2 modchip ($120)",
  "Switch Lite modchip ($140)",
] as const;

export const quoteRequestTypes = [
  "Electronic repair",
  "Custom build commission: GWii ($900)",
  "Custom build commission: Wii Miicro Deluxe ($450)",
  "PS4 / other mod",
  "Custom shell or RGB",
  "General question",
] as const;

/** ?build=<slug> on /quote preselects the matching request type */
export const buildRequestType = {
  gwii: quoteRequestTypes[1],
  "wii-miicro": quoteRequestTypes[2],
} as const;

export const PHOTO_MAX_FILES = 3;
/** after client-side downscaling; the Worker rejects anything larger */
export const PHOTO_MAX_BYTES = 2_000_000;
export const PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

const trimmed = (min: number, max: number, label: string) =>
  z
    .string({ error: `${label} is required.` })
    .trim()
    .min(min, `${label} must be at least ${min} characters.`)
    .max(max, `${label} must be at most ${max} characters.`);

const base = {
  name: trimmed(2, 80, "Name"),
  email: z.string({ error: "Email is required." }).trim().toLowerCase().pipe(z.email("Please enter a valid email address.").max(254)),
  phone: z
    .string()
    .trim()
    .max(30)
    .regex(/^[0-9+().\-\s]*$/, "Please enter a valid phone number.")
    .optional()
    .or(z.literal("")),
  delivery: z.enum(deliveryOptions, { message: "Choose how you'll get your device to me." }),
  message: trimmed(20, 2000, "Message"),
  consent: z.literal("yes", { message: "Please confirm I can contact you about this request." }),
  /** honeypot (field name hp_7f3: non-semantic so browser autofill ignores it): must be empty */
  hp: z.string().max(0).optional().or(z.literal("")),
};

export const bookSchema = z.object({
  ...base,
  services: z
    .array(z.enum(bookServiceOptions))
    .min(1, "Select at least one service.")
    .max(bookServiceOptions.length),
});

export const quoteSchema = z.object({
  ...base,
  requestType: z.enum(quoteRequestTypes, { message: "Choose a request type." }),
});

export type BookInput = z.infer<typeof bookSchema>;
export type QuoteInput = z.infer<typeof quoteSchema>;

/** Field names used in the HTML forms (multipart/form-data). */
export const fieldNames = {
  name: "name",
  email: "email",
  phone: "phone",
  delivery: "delivery",
  message: "message",
  consent: "consent",
  honeypot: "hp_7f3",
  services: "services",
  requestType: "requestType",
  photos: "photos",
  turnstile: "cf-turnstile-response",
} as const;

/** JSON response contract for /api/book and /api/quote */
export type ApiResult =
  | { ok: true; message: string }
  | { ok: false; error: "validation"; fieldErrors: Record<string, string[]> }
  | { ok: false; error: "captcha" | "rate_limited" | "too_large" | "not_configured" | "server"; message: string };

/** Convert multipart FormData into the plain object the schemas expect. */
export function formDataToObject(fd: FormData) {
  const get = (k: string) => {
    const v = fd.get(k);
    return typeof v === "string" ? v : undefined;
  };
  return {
    name: get(fieldNames.name),
    email: get(fieldNames.email),
    phone: get(fieldNames.phone),
    delivery: get(fieldNames.delivery),
    message: get(fieldNames.message),
    consent: get(fieldNames.consent),
    hp: get(fieldNames.honeypot),
    services: fd.getAll(fieldNames.services).filter((v): v is string => typeof v === "string"),
    requestType: get(fieldNames.requestType),
  };
}
