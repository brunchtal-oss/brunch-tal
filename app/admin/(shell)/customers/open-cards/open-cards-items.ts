import type { StatusTone } from "@/components/shared/status-chip"
import { adminCopy } from "@/lib/copy/admin"
import { formatDayMonth } from "@/lib/time"

import { entryLines, type CardEntry, type EntryLine } from "../[id]/card-items"
import { entitlementHref } from "../[id]/entitlements/[entitlementId]/entitlement-items"
import { customerHref } from "../customer-items"

// What /admin/customers/open-cards shows for admin_list_open_cards (story
// 4.3, CAP-42; pure: the URL's filter and the RPC's rows in, items out).
// Which cards are open, their numbers, "expiring" and the order are decided
// in SQL (entitlement_balances, AD-14); the entries are worded with the
// customer card's entryLines, so a card reads the same in both places.

const copy = adminCopy.customers.openCards

export const OPEN_CARDS_PATH = "/admin/customers/open-cards"

export const FILTERS = ["all", "available", "expiring"] as const

export type OpenCardsFilter = (typeof FILTERS)[number]

export type OpenCardRow = {
  entitlement_id: string
  // null while the purchase is not bound (the payer's label instead).
  customer_id: string | null
  customer_label: string | null
  product_name: string | null
  paid_on: string
  original_units: number
  available: number
  reserved: number
  used: number
  expires_on: string
  days_left: number
  is_expiring: boolean
  // Story 3.13: a correction moved the expiry later than it was.
  is_extended?: boolean
  entries: CardEntry[]
}

type SearchParams = Record<string, string | string[] | undefined>

// ?filter= of the URL; anything unknown falls back to all.
export function parseFilter(params: SearchParams): OpenCardsFilter {
  const value = params.filter
  const filter = Array.isArray(value) ? value[0] : value
  return FILTERS.find((f) => f === filter) ?? "all"
}

export function filterHref(filter: OpenCardsFilter): string {
  return filter === "all"
    ? OPEN_CARDS_PATH
    : `${OPEN_CARDS_PATH}?filter=${filter}`
}

// The row's anchor (the home's "expiring" rows link to it).
export function cardAnchor(entitlementId: string): string {
  return `card-${entitlementId}`
}

// The filtered list with one card targeted (the home's expiring rows, user
// decision 2026-10-10).
export function expiringCardHref(entitlementId: string): string {
  return `${filterHref("expiring")}#${cardAnchor(entitlementId)}`
}

export type FilterItem = {
  key: OpenCardsFilter
  href: string
  label: string
  current: boolean
}

export function filterItems(current: OpenCardsFilter): FilterItem[] {
  return FILTERS.map((key) => ({
    key,
    href: filterHref(key),
    label: copy.filters[key],
    current: key === current,
  }))
}

export type OpenCardItem = {
  key: string
  anchor: string
  name: string
  productName: string
  purchased: string
  paidOn: string
  until: string
  expiresOn: string
  // Story 3.13: "(כולל הארכה)" after the expiry, and the card's page (also
  // for a purchase not bound yet).
  extended: boolean
  detailsHref: string
  chip: { tone: StatusTone; label: string } | null
  entries: EntryLine[]
  // null for a purchase not bound yet: no buttons.
  bookHref: string | null
  profileHref: string | null
}

export function toOpenCardItem(row: OpenCardRow): OpenCardItem {
  const name = row.customer_label?.trim() || adminCopy.home.newCustomer
  return {
    key: row.entitlement_id,
    anchor: cardAnchor(row.entitlement_id),
    name,
    productName: row.product_name ?? "",
    purchased: copy.purchased(formatDayMonth(row.paid_on)),
    paidOn: row.paid_on,
    until: adminCopy.customers.card.validUntil(formatDayMonth(row.expires_on)),
    expiresOn: row.expires_on,
    extended: row.is_extended === true,
    detailsHref: entitlementHref(row.customer_id, row.entitlement_id),
    chip: row.is_expiring
      ? { tone: "warning", label: adminCopy.customers.card.expiring }
      : null,
    // An open card is never expired (the server lists only those).
    entries: entryLines({ ...row, is_expired: false }),
    bookHref: row.customer_id
      ? `/admin/sessions/book?customer=${encodeURIComponent(row.customer_id)}`
      : null,
    profileHref: row.customer_id ? customerHref(row.customer_id) : null,
  }
}
