/**
 * Client address → abuse-limit bucket. An IPv4 address is its own bucket; an IPv6 address counts as its /64,
 * because ISPs give each subscriber at least a /64 and per-address limits would be trivial to rotate around.
 * Pure: the result is only ever used as HMAC input (reviews/visitor-limit.ts), never stored or logged.
 */

/** Longest textual IPv6 address (eight groups, or six groups plus a dotted IPv4). */
const MAX_IP_LENGTH = 45;
const DECIMAL_OCTET = /^(0|[1-9]\d{0,2})$/;
const HEX_GROUP = /^[0-9a-f]{1,4}$/;

/** "a.b.c.d" → four octets, or null. No leading zeros (some parsers read those as octal). */
function parseIpv4(text: string): number[] | null {
  const parts = text.split(".");
  if (parts.length !== 4 || !parts.every((p) => DECIMAL_OCTET.test(p))) return null;
  const octets = parts.map(Number);
  return octets.every((o) => o <= 255) ? octets : null;
}

/** Lower-case IPv6 text → eight 16-bit groups, or null. Handles "::" and a trailing dotted IPv4. */
function parseIpv6(text: string): number[] | null {
  let rest = text;
  const embeddedV4: number[] = [];
  const lastGroupStart = rest.lastIndexOf(":") + 1;
  if (rest.includes(".", lastGroupStart)) {
    const v4 = parseIpv4(rest.slice(lastGroupStart));
    if (!v4) return null;
    embeddedV4.push(v4[0] * 256 + v4[1], v4[2] * 256 + v4[3]);
    rest = rest.slice(0, lastGroupStart);
    if (!rest.endsWith("::")) rest = rest.slice(0, -1); // "::ffff:" → "::ffff", but "::" stays "::"
  }

  const halves = rest.split("::");
  if (halves.length > 2) return null;
  const groupsOf = (part: string) => (part === "" ? [] : part.split(":"));
  const head = groupsOf(halves[0] ?? "");
  const tail = halves.length === 2 ? groupsOf(halves[1] ?? "") : [];
  if (![...head, ...tail].every((g) => HEX_GROUP.test(g))) return null;

  const explicitCount = head.length + tail.length + embeddedV4.length;
  const isCompressed = halves.length === 2;
  if (isCompressed ? explicitCount > 7 : explicitCount !== 8) return null;
  const toNumber = (g: string) => parseInt(g, 16);
  return [
    ...head.map(toNumber),
    ...Array<number>(isCompressed ? 8 - explicitCount : 0).fill(0),
    ...tail.map(toNumber),
    ...embeddedV4,
  ];
}

const isIpv4Mapped = (groups: number[]) => groups.slice(0, 5).every((g) => g === 0) && groups[5] === 0xffff;

/**
 * The canonical bucket for a CF-Connecting-IP value: `v4:<address>` or `v6:<first four groups>::/64`.
 * IPv4-mapped IPv6 (::ffff:a.b.c.d) counts as the IPv4 address. Missing or malformed input → null.
 */
export function ipBucket(raw: string | null | undefined): string | null {
  const text = (raw ?? "").trim().toLowerCase();
  if (text === "" || text.length > MAX_IP_LENGTH) return null;

  if (!text.includes(":")) {
    const v4 = parseIpv4(text);
    return v4 ? `v4:${v4.join(".")}` : null;
  }

  const groups = parseIpv6(text);
  if (!groups) return null;
  if (isIpv4Mapped(groups)) {
    const [hi = 0, lo = 0] = groups.slice(6);
    return `v4:${hi >> 8}.${hi & 0xff}.${lo >> 8}.${lo & 0xff}`;
  }
  return `v6:${groups
    .slice(0, 4)
    .map((g) => g.toString(16))
    .join(":")}::/64`;
}
