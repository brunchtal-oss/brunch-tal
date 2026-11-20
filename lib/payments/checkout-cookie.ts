// The browser's `bt_checkout` cookie (online payments; pure, no server
// import, so the "continue joining" banner reads it without a DB call).
// Up to 5 "<checkout id>.<browser secret>" entries, newest first. The
// return and failure routes remove an entry once its checkout reached a
// final outcome; only open, pending or paid-awaiting-join entries remain.

export const CHECKOUT_COOKIE = "bt_checkout"
export const MAX_COOKIE_ENTRIES = 5

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const SECRET = /^[A-Za-z0-9_-]{16,200}$/

export type CheckoutEntry = { id: string; secret: string }

export function isCheckoutId(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value)
}

export function isCheckoutSecret(value: unknown): value is string {
  return typeof value === "string" && SECRET.test(value)
}

/** The valid entries of the `bt_checkout` cookie, newest first (at most 5). */
export function parseCheckoutCookie(
  value: string | null | undefined
): CheckoutEntry[] {
  if (!value) return []
  const entries: CheckoutEntry[] = []
  for (const part of value.split(",")) {
    const dot = part.indexOf(".")
    if (dot < 0) continue
    const id = part.slice(0, dot)
    const secret = part.slice(dot + 1)
    if (isCheckoutId(id) && isCheckoutSecret(secret)) {
      entries.push({ id, secret })
    }
  }
  return entries.slice(0, MAX_COOKIE_ENTRIES)
}

export function serializeCheckoutCookie(entries: CheckoutEntry[]): string {
  return entries
    .slice(0, MAX_COOKIE_ENTRIES)
    .map((e) => `${e.id}.${e.secret}`)
    .join(",")
}

/** The entry of checkout `c`, else null (no c, or no match). */
export function checkoutEntryFor(
  cookie: string | null | undefined,
  c: string | null | undefined
): CheckoutEntry | null {
  if (!isCheckoutId(c)) return null
  return parseCheckoutCookie(cookie).find((e) => e.id === c) ?? null
}

/** The cookie without checkout `id`: the rest, or null when none is left. */
export function withoutCheckoutEntry(
  cookie: string | null | undefined,
  id: string
): string | null {
  const left = parseCheckoutCookie(cookie).filter((e) => e.id !== id)
  return left.length > 0 ? serializeCheckoutCookie(left) : null
}

/** The newest entry's checkout id (the banner's "להמשך"), else null. */
export function newestCheckoutId(
  cookie: string | null | undefined
): string | null {
  return parseCheckoutCookie(cookie)[0]?.id ?? null
}

// The outcome of a real return (spec-online-payments-grow-b.md, Decisions
// after review): /pay/return and /pay/failed set it for one minute next to
// their redirect, and a page shows a ?payment= notice only when it matches
// the parameter, so a forged link shows nothing. It carries the product
// kind, so a card gets its own wording.
export const PAYMENT_OUTCOME_COOKIE = "bt_payment_outcome"
export const PAYMENT_OUTCOME_MAX_AGE = 60

export type PaymentKind = "card" | "session"

export type PaymentOutcome = { payment: string; kind: PaymentKind }

const OUTCOME =
  /^(paid|failed|expired|issue|no_place|not_found|review)\.(card|session)$/

export function serializePaymentOutcome(outcome: PaymentOutcome): string {
  return `${outcome.payment}.${outcome.kind}`
}

/** The outcome when the cookie holds the same payment as the parameter. */
export function matchPaymentOutcome(
  param: string | null | undefined,
  cookie: string | null | undefined
): PaymentOutcome | null {
  const found = OUTCOME.exec(cookie ?? "")
  if (!found || found[1] !== param) return null
  return { payment: found[1], kind: found[2] as PaymentKind }
}

/** The outcome a redirect path carries (its ?payment=), else null. */
export function outcomeOfPath(
  path: string,
  kind: PaymentKind
): PaymentOutcome | null {
  const query = path.indexOf("?")
  if (query < 0) return null
  const payment = new URLSearchParams(path.slice(query + 1)).get("payment")
  if (!payment || !OUTCOME.test(`${payment}.${kind}`)) return null
  return { payment, kind }
}
