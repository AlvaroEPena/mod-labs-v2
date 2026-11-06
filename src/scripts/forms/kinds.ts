/**
 * The three enhanced forms ([data-lab-form="book" | "quote" | "review"]) and what differs between them:
 * which shared schema validates them (lazy-loaded on first interaction, so zod never ships with the
 * page) and the copy they use. Everything else lives in the controller.
 */
import { requestCopy, reviewCopy, type CopySet } from "./messages";

export const FORM_KINDS = ["book", "quote", "review"] as const;
export type FormKind = (typeof FORM_KINDS)[number];
export const isFormKind = (v: unknown): v is FormKind => typeof v === "string" && (FORM_KINDS as readonly string[]).includes(v);

type Issue = { path: ReadonlyArray<PropertyKey>; message: string };
type Parsed = { success: true } | { success: false; error: { issues: ReadonlyArray<Issue> } };
/** null when the form data is valid, else the schema's issues */
export type Validator = (fd: FormData) => ReadonlyArray<Issue> | null;

const issuesOf = (r: Parsed) => (r.success ? null : r.error.issues);

let forms: Promise<typeof import("../../lib/forms/schema")> | undefined;
let reviews: Promise<typeof import("../../lib/reviews/contract")> | undefined;
const formsSchema = () => (forms ??= import("../../lib/forms/schema"));
const reviewsContract = () => (reviews ??= import("../../lib/reviews/contract"));

export type KindConfig = { copy: CopySet; loadValidator: () => Promise<Validator> };

export const formKinds: Record<FormKind, KindConfig> = {
  book: {
    copy: requestCopy,
    loadValidator: async () => {
      const s = await formsSchema();
      return (fd) => issuesOf(s.bookSchema.safeParse(s.formDataToObject(fd)));
    },
  },
  quote: {
    copy: requestCopy,
    loadValidator: async () => {
      const s = await formsSchema();
      return (fd) => issuesOf(s.quoteSchema.safeParse(s.formDataToObject(fd)));
    },
  },
  review: {
    copy: reviewCopy,
    loadValidator: async () => {
      const c = await reviewsContract();
      return (fd) => issuesOf(c.reviewSchema.safeParse(c.reviewFormToObject(fd)));
    },
  },
};
