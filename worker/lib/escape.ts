const HTML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

/** Escape a string for safe interpolation into HTML text or quoted attribute values. */
export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => HTML_ESCAPES[ch] ?? ch);
}

/** Collapse whitespace/control characters so a value is safe for a single-line header (e.g. subject). */
export function singleLine(value: string, maxLength = 200): string {
  // eslint-disable-next-line no-control-regex
  const cleaned = value.replace(/[\u0000-\u001f\u007f\s]+/g, " ").trim();
  return cleaned.length > maxLength ? `${cleaned.slice(0, maxLength - 1)}…` : cleaned;
}

/** Make an uploaded filename safe for an email attachment. */
export function safeFilename(name: string, fallback: string): string {
  const base = name.split(/[\\/]/).pop() ?? "";
  const cleaned = base
    .replace(/[^A-Za-z0-9._ -]+/g, "_")
    .replace(/^\.+/, "")
    .trim()
    .slice(0, 100);
  return cleaned.length > 0 ? cleaned : fallback;
}
