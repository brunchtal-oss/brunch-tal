// Money is integer agorot (ILS) in every layer (AD-9). This is the only place
// that formats a sum for display or parses a sum typed by the admin. No
// floating point: parsing works on the digit string, and sums are computed in
// SQL. `npm run lint` forbids parseFloat here.

const GROUPING = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 })

/**
 * "128 ₪", "1,234 ₪". A sum with agorot keeps them exactly: "127.50 ₪" (never
 * rounded). Throws on a value that is not a safe integer.
 */
export function formatAgorot(agorot: number): string {
  if (!Number.isSafeInteger(agorot)) {
    throw new RangeError("formatAgorot expects an integer amount of agorot")
  }
  const sign = agorot < 0 ? "-" : ""
  const abs = Math.abs(agorot)
  const shekels = (abs - (abs % 100)) / 100
  const rest = abs % 100
  const fraction = rest === 0 ? "" : `.${String(rest).padStart(2, "0")}`
  return `${sign}${GROUPING.format(shekels)}${fraction} ₪`
}

const BIDI_MARKS = /[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g

// Whole shekels, optionally with correct thousands grouping, then up to two
// decimal digits. "12,34", "1.234", "1e3" and negative sums do not match.
const SHEKELS = /^(\d+|\d{1,3}(?:,\d{3})+)(?:\.(\d{1,2}))?$/

/**
 * Parses what the admin typed ("128", "128.5", " 1,234.50 ₪") into agorot.
 * Returns null for anything that is not a non-negative sum with at most two
 * decimal digits, or that exceeds Number.MAX_SAFE_INTEGER agorot.
 */
export function parseShekelsToAgorot(input: string): number | null {
  // Surrounding spaces and one ₪ sign before or after the number are allowed;
  // a space inside the number ("1 2") is not.
  // Text pasted from the RTL UI may carry invisible bidi marks: LRM/RLM
  // (U+200E, U+200F), embeddings (U+202A-U+202E) and isolates
  // (U+2066-U+2069).
  const compact = input
    .replace(BIDI_MARKS, "")
    .trim()
    .replace(/^₪\s*|\s*₪$/, "")
  const match = SHEKELS.exec(compact)
  if (!match) return null
  const whole = match[1].replace(/,/g, "")
  const fraction = (match[2] ?? "").padEnd(2, "0")
  const agorot = BigInt(whole) * BigInt(100) + BigInt(fraction)
  if (agorot > BigInt(Number.MAX_SAFE_INTEGER)) return null
  return Number(agorot)
}
