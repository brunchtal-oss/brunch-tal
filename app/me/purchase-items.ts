// What the customer's home and purchase history show (story 4.12), built
// from the rows of get_my_entitlements (pure: rows in, items out). Every
// balance and derived state (days_left, is_expiring, is_used_up,
// is_expired) comes from the RPC (AD-14, AD-8); nothing is computed from a
// clock here. The product name comes from the payment's product_snapshot;
// a pinned purchase is named "בראנץ׳ {concept}", not by the product (user
// decision 2026-10-05). Home has no message blocks and no receipts (user
// decision 2026-10-06).

import { customerCopy } from "@/lib/copy/customer"

export type EntitlementKind = "card" | "single" | "intro" | "couple"

// One row of get_my_entitlements, in camelCase.
export type MyEntitlement = {
  id: string
  kind: EntitlementKind
  status: string
  productName: string
  amountAgorot: number
  paidOn: string
  originalUnits: number
  available: number
  reserved: number
  used: number
  expiresOn: string
  isExpired: boolean
  expiredBeforeBound: boolean
  daysLeft: number
  isExpiring: boolean
  isUsedUp: boolean
  validityDays: number | null
  pinnedEventId: string | null
  paymentId: string
}

const KINDS: readonly EntitlementKind[] = ["card", "single", "intro", "couple"]

const str = (v: unknown): string | null => (typeof v === "string" ? v : null)
const int = (v: unknown): number | null =>
  typeof v === "number" && Number.isInteger(v) ? v : null

/** The RPC's jsonb; a malformed row is left out. */
export function parseMyEntitlements(data: unknown): MyEntitlement[] {
  if (!Array.isArray(data)) return []
  return data.flatMap((raw): MyEntitlement[] => {
    if (!raw || typeof raw !== "object") return []
    const r = raw as Record<string, unknown>
    const id = str(r.entitlement_id)
    const paymentId = str(r.payment_id)
    const kind = KINDS.find((k) => k === r.kind)
    const expiresOn = str(r.expires_on)
    const paidOn = str(r.paid_on)
    const amount = int(r.amount_agorot)
    const daysLeft = int(r.days_left)
    if (
      !id ||
      !paymentId ||
      !kind ||
      !expiresOn ||
      !paidOn ||
      amount === null ||
      daysLeft === null
    ) {
      return []
    }
    const validity = int(r.validity_days)
    return [
      {
        id,
        kind,
        status: str(r.status) ?? "",
        productName: str(r.product_name) ?? "",
        amountAgorot: amount,
        paidOn,
        originalUnits: int(r.original_units) ?? 0,
        available: int(r.available) ?? 0,
        reserved: int(r.reserved) ?? 0,
        used: int(r.used) ?? 0,
        expiresOn,
        isExpired: r.is_expired === true,
        expiredBeforeBound: r.expired_before_bound === true,
        daysLeft,
        isExpiring: r.is_expiring === true,
        isUsedUp: r.is_used_up === true,
        validityDays: validity !== null && validity > 0 ? validity : null,
        pinnedEventId: str(r.pinned_event_id),
        paymentId,
      },
    ]
  })
}

/**
 * Open: active, not expired (or expired before it was bound, shown with its
 * note, story 2.4) and not used up.
 */
export function isOpen(e: MyEntitlement): boolean {
  return (
    e.status === "active" &&
    (!e.isExpired || e.expiredBeforeBound) &&
    !e.isUsedUp
  )
}

/**
 * The word of a past entitlement's status-chip (expired tone): cancelled
 * (status not active), expired, or used up; null for an open one.
 */
export function pastStatus(e: MyEntitlement): string | null {
  if (e.status !== "active") return customerCopy.entitlementCancelled
  if (e.isExpired) return customerCopy.entitlementExpired
  if (e.isUsedUp) return customerCopy.entitlementUsedUp
  return null
}

/** The shown name: "בראנץ׳ {concept}" for a pinned purchase, else the product. */
export function entitlementName(
  e: Pick<MyEntitlement, "pinnedEventId" | "productName">,
  conceptNames: ReadonlyMap<string, string>
): string {
  const concept = e.pinnedEventId ? conceptNames.get(e.pinnedEventId) : null
  return concept ? customerCopy.sessionTitle(concept) : e.productName
}

// A session ahead of her (her confirmed booking), from RLS.
export type SessionRow = {
  id: string
  starts_at: string
  concept_name: string
}

/**
 * The home's card (user decision 2026-10-06): only an open, active card,
 * never a pinned purchase. A card that ended (used up, expired, also before
 * it was bound) leaves home and stays in the purchase history.
 */
export function isHomeCard(e: MyEntitlement): boolean {
  return (
    e.kind === "card" &&
    e.pinnedEventId === null &&
    !e.expiredBeforeBound &&
    isOpen(e)
  )
}

/** No session ahead and no active card: the empty-state. */
export function isEmptyHome(upcomingCount: number, cardCount: number): boolean {
  return upcomingCount === 0 && cardCount === 0
}

/** The purchase history's order: newest purchase first (display only). */
export function byPaidOnDesc(
  a: Pick<MyEntitlement, "paidOn" | "id">,
  b: Pick<MyEntitlement, "paidOn" | "id">
): number {
  if (a.paidOn !== b.paidOn) return a.paidOn < b.paidOn ? 1 : -1
  return a.id < b.id ? 1 : a.id > b.id ? -1 : 0
}
