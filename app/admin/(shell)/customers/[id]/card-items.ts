import { babyAge } from "@/components/admin/baby-age"
import { METER_MAX } from "@/components/customer/balance-card"
import type { StatusTone } from "@/components/shared/status-chip"
import { consentLines } from "@/lib/admin/photo-consents"
import { adminCopy } from "@/lib/copy/admin"
import { formatAgorot } from "@/lib/money"
import { formatLocalPhone } from "@/lib/phone"
import {
  formatDayMonth,
  formatSessionDateTime,
  formatShortDate,
  formatTime,
  formatWeekday,
} from "@/lib/time"

// What the customer card shows for admin_get_customer (pure: the RPC's
// result in, items out). Balances, expiry, "expiring" and "used up" are
// decided in SQL (entitlement_balances, AD-14), and each entry comes from
// booking_allocations; this file only orders, words and formats them.

const copy = adminCopy.customers.card

// A note's limit after trimming (admin_add_customer_note refuses more).
export const NOTE_MAX = 1000

export type CardProfile = {
  id: string
  full_name: string
  phone_e164: string | null
  email: string | null
  activated_at: string | null
  created_at: string
  dietary_notes: string | null
  photo_consent: boolean
  photo_consent_at: string | null
  // Story 2.13: the personal photos (the WhatsApp group).
  personal_photo_consent: boolean
  personal_photo_consent_at: string | null
  last_activity_on: string | null
}

export type CardBaby = { name: string; birth_date: string }

// One unit of an entitlement taken by a booking that was not cancelled.
export type CardEntry = {
  status: "confirmed" | "completed"
  starts_at: string
  concept_name: string
  event_id: string
}

export type CardEntitlement = {
  entitlement_id: string
  kind: string
  status: string
  product_name: string | null
  original_units: number
  available: number
  reserved: number
  used: number
  expires_on: string
  is_expired: boolean
  days_left: number
  is_expiring: boolean
  is_used_up: boolean
  pinned_event_id: string | null
  entries: CardEntry[]
}

export type CardBooking = {
  booking_id: string
  event_id: string
  concept_name: string
  starts_at: string
  status: keyof typeof copy.bookingStatus
  party_size: number
  created_at: string
}

export type CardPayment = {
  payment_id: string
  product_name: string | null
  amount_agorot: number
  paid_on: string
  payment_method_name: string | null
  status: string
}

export type CardNote = { id: string; body: string; created_at: string }

export type CustomerCard = {
  profile: CardProfile
  babies: CardBaby[]
  entitlements: CardEntitlement[]
  bookings: CardBooking[]
  payments: CardPayment[]
  notes: CardNote[]
}

export type CardHeader = {
  name: string
  phone: string | null
  notActivated: boolean
}

export function cardHeader(profile: CardProfile): CardHeader {
  return {
    name: profile.full_name,
    phone: profile.phone_e164 ? formatLocalPhone(profile.phone_e164) : null,
    notActivated: profile.activated_at === null,
  }
}

// value: one line, or several (the photo consents).
export type DetailRow = {
  label: string
  value: string | readonly string[]
  ltr?: boolean
}

// The details under the balances (the phone is in the header). The photo
// consents: a line each, without a date (story 2.13, user decision
// 2026-10-07).
export function detailRows(profile: CardProfile): DetailRow[] {
  const rows: DetailRow[] = [
    { label: copy.email, value: profile.email ?? "", ltr: true },
    {
      label: copy.joined,
      value: profile.activated_at
        ? formatShortDate(profile.activated_at)
        : copy.notActivatedYet,
    },
    {
      label: copy.lastActivity,
      value: profile.last_activity_on
        ? formatShortDate(profile.last_activity_on)
        : adminCopy.customers.noActivity,
    },
    {
      label: copy.dietary,
      value: profile.dietary_notes?.trim() || copy.none,
    },
    {
      label: copy.photoConsent,
      value: consentLines({
        atmosphere: profile.photo_consent,
        personal: profile.personal_photo_consent,
      }),
    },
  ]
  return rows.filter((row) => row.value !== "")
}

export type BabyItem = { key: string; name: string; age: string }

// The age on `today` (the local day, display only).
export function toBabyItems(babies: CardBaby[], today: string): BabyItem[] {
  return babies.map((baby, i) => ({
    key: `${i}:${baby.name}`,
    name: baby.name,
    age: babyAge(baby.birth_date, today),
  }))
}

// Cards first, then every other entitlement; each group by expiry, as the
// server ordered it (phone check, user decision 2026-10-07).
export function orderBalances(rows: CardEntitlement[]): CardEntitlement[] {
  const byExpiry = (a: CardEntitlement, b: CardEntitlement) =>
    a.expires_on === b.expires_on
      ? a.entitlement_id.localeCompare(b.entitlement_id)
      : a.expires_on < b.expires_on
        ? -1
        : 1
  return [
    ...rows.filter((row) => row.kind === "card").sort(byExpiry),
    ...rows.filter((row) => row.kind !== "card").sort(byExpiry),
  ]
}

// One line per entry, drawn like the meter's plate: used, booked, free.
export type EntryLine = {
  key: string
  kind: "used" | "booked" | "free"
  text: string
}

function sessionDay(startsAt: string): string {
  return `${formatWeekday(startsAt)} ${formatDayMonth(startsAt)}`
}

// The entries by session date (used "נוצלה · יום DD.MM", booked "שוריינה
// · יום DD.MM"), then one line per free entry: "פנויה, יש לשריין", or
// "לא נוצלה" once the card expired.
export function entryLines(row: CardEntitlement): EntryLine[] {
  const taken = [...row.entries]
    .sort((a, b) => (a.starts_at < b.starts_at ? -1 : 1))
    .map((entry, i): EntryLine => {
      const used = entry.status === "completed"
      return {
        key: `${i}:${entry.event_id}`,
        kind: used ? "used" : "booked",
        text: used
          ? copy.entryUsed(sessionDay(entry.starts_at))
          : copy.entryBooked(sessionDay(entry.starts_at)),
      }
    })
  const free = Array.from(
    { length: Math.max(row.available, 0) },
    (_, i): EntryLine => ({
      key: `free:${i}`,
      kind: "free",
      text: row.is_expired ? copy.entryUnused : copy.entryFree,
    })
  )
  return [...taken, ...free]
}

export type BalanceItem = {
  key: string
  productName: string
  used: number
  reserved: number
  total: number
  meter: boolean
  summary: string
  until: string
  expiresOn: string
  chip: { tone: StatusTone; label: string } | null
  entries: EntryLine[]
}

function balanceChip(row: CardEntitlement): BalanceItem["chip"] {
  if (row.status !== "active") return { tone: "expired", label: copy.cancelled }
  if (row.is_expired) return { tone: "expired", label: copy.expired }
  if (row.is_used_up) return { tone: "expired", label: copy.usedUp }
  if (row.is_expiring) return { tone: "warning", label: copy.expiring }
  return null
}

export function toBalanceItem(row: CardEntitlement): BalanceItem {
  const total = row.original_units
  return {
    key: row.entitlement_id,
    productName: row.product_name ?? "",
    used: row.used,
    reserved: row.reserved,
    total,
    meter: total > 0 && total <= METER_MAX,
    summary: copy.balanceSummary(row.used, row.reserved, row.available),
    until: copy.validUntil(formatDayMonth(row.expires_on)),
    expiresOn: row.expires_on,
    chip: balanceChip(row),
    entries: entryLines(row),
  }
}

// A single entitlement (every kind but a card; second phone check, user
// decision 2026-10-07): shown only while not used (active, not expired,
// used = 0), as its product and one line: the booked session, or "to
// book" with its validity. No meter, counts or entries.
export type SingleItem = {
  key: string
  productName: string
  line: string
  chip: { tone: StatusTone; label: string } | null
}

export function isOpenSingle(row: CardEntitlement): boolean {
  return (
    row.kind !== "card" &&
    row.status === "active" &&
    !row.is_expired &&
    row.used === 0
  )
}

export function toSingleItem(row: CardEntitlement): SingleItem {
  const booked = row.entries
    .filter((entry) => entry.status === "confirmed")
    .sort((a, b) => (a.starts_at < b.starts_at ? -1 : 1))[0]
  return {
    key: row.entitlement_id,
    productName: row.product_name ?? "",
    line: booked
      ? copy.singleBooked(booked.concept_name, sessionDay(booked.starts_at))
      : copy.singleToBook(formatDayMonth(row.expires_on)),
    chip: row.is_expiring ? { tone: "warning", label: copy.expiring } : null,
  }
}

export type BalanceView =
  ({ variant: "card" } & BalanceItem) | ({ variant: "single" } & SingleItem)

// The balances section: every card (as before), then the open singles,
// each group by expiry.
export function balanceViews(rows: CardEntitlement[]): BalanceView[] {
  return orderBalances(rows).flatMap((row): BalanceView[] => {
    if (row.kind === "card") return [{ variant: "card", ...toBalanceItem(row) }]
    return isOpenSingle(row)
      ? [{ variant: "single", ...toSingleItem(row) }]
      : []
  })
}

export type BookingItem = {
  key: string
  href: string
  title: string
  when: string
  startsAt: string
  status: string
  tone: StatusTone
  couple: boolean
}

const BOOKING_TONES: Record<CardBooking["status"], StatusTone> = {
  confirmed: "success",
  completed: "pending",
  cancelled: "expired",
}

export function toBookingItem(row: CardBooking): BookingItem {
  return {
    key: row.booking_id,
    href: `/admin/sessions/${row.event_id}`,
    title: adminCopy.sessions.sessionTitle(row.concept_name),
    when: formatSessionDateTime(row.starts_at),
    startsAt: row.starts_at,
    status: copy.bookingStatus[row.status] ?? row.status,
    tone: BOOKING_TONES[row.status] ?? "pending",
    couple: row.party_size === 2,
  }
}

export type PaymentLine = {
  key: string
  product: string
  detail: string
  voided: boolean
}

export function toPaymentLine(row: CardPayment): PaymentLine {
  return {
    key: row.payment_id,
    product: row.product_name ?? "",
    detail: copy.purchaseDetail(
      formatAgorot(row.amount_agorot),
      row.payment_method_name ?? "",
      formatShortDate(row.paid_on)
    ),
    voided: row.status !== "approved",
  }
}

export type NoteItem = { id: string; body: string; when: string }

export function toNoteItem(row: CardNote): NoteItem {
  return {
    id: row.id,
    body: row.body,
    when: `${formatShortDate(row.created_at)}, ${formatTime(row.created_at)}`,
  }
}

// The card's sub-pages (phone check, 2026-10-07).
export function historyHref(
  customerId: string,
  page: "bookings" | "purchases"
): string {
  return `/admin/customers/${encodeURIComponent(customerId)}/${page}`
}
