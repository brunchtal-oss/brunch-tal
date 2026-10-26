import { adminCopy } from "@/lib/copy/admin"
import { isErrorCode, type ErrorCode } from "@/lib/errors"
import {
  formatDayMonth,
  formatSessionDate,
  formatShortDate,
  isPlainDate,
} from "@/lib/time"

import { entryLines, type CardEntry, type EntryLine } from "../../card-items"

// What the card's page shows (story 3.13; pure: the RPCs' results in, items
// out): admin_get_entitlement and preview_admin_correct_entitlement. Every
// balance, fit and affected booking is decided in SQL; this file only
// parses, words and formats them, and turns the edit box into the value the
// RPC takes.

const copy = adminCopy.customers.entitlement

export const CORRECTION_FIELDS = [
  "expires_on",
  "units",
  "allowed_weekdays",
  "eligible_event_kind",
] as const

export type CorrectionField = (typeof CORRECTION_FIELDS)[number]

export function isCorrectionField(value: unknown): value is CorrectionField {
  return (
    typeof value === "string" &&
    (CORRECTION_FIELDS as readonly string[]).includes(value)
  )
}

// The sensitive action and the dialog wording of a field: weekdays and the
// event kind share "the terms".
export function sensitiveOf(
  field: CorrectionField
): "entitlement_expiry" | "entitlement_units" | "entitlement_terms" {
  if (field === "expires_on") return "entitlement_expiry"
  if (field === "units") return "entitlement_units"
  return "entitlement_terms"
}

export function wordingOf(
  field: CorrectionField
): "expires_on" | "units" | "terms" {
  return field === "expires_on" || field === "units" ? field : "terms"
}

export type EntitlementBooking = {
  booking_id: string
  event_id: string
  concept_name: string
  starts_at: string
  status: string
}

export type EntitlementCorrection = {
  correction_id: string
  field: string
  old_value: unknown
  new_value: unknown
  reason: string | null
  actor_kind: string
  created_at: string
  related_event_id: string | null
  related_concept_name: string | null
  related_starts_at: string | null
  // An automatic extension's local week (its Sunday, YYYY-MM-DD); null
  // for Tal's corrections (story 3.14).
  week_start: string | null
}

export type EntitlementPage = {
  entitlement_id: string
  // Story 2.14: the purchase's payment, and its void (when, why).
  payment_id: string
  payment_status: string
  voided_at: string | null
  void_reason: string | null
  customer_id: string | null
  customer_label: string | null
  product_name: string | null
  kind: string
  status: string
  correctable: boolean
  paid_on: string
  original_units: number
  available: number
  reserved: number
  used: number
  valid_from: string
  expires_on: string
  is_expired: boolean
  allowed_weekdays: number[] | null
  eligible_event_kind: string
  is_extended: boolean
  entries: CardEntry[]
  bookings: EntitlementBooking[]
  corrections: EntitlementCorrection[]
}

// The segment of the page's URL for a purchase not bound yet (no customer
// id): /admin/customers/unbound/entitlements/<id>.
export const UNBOUND_SEGMENT = "unbound"

export function entitlementHref(
  customerId: string | null,
  entitlementId: string
): string {
  return `/admin/customers/${encodeURIComponent(
    customerId ?? UNBOUND_SEGMENT
  )}/entitlements/${encodeURIComponent(entitlementId)}`
}

// Whether the URL's customer segment is the page's customer (else 404).
export function segmentMatches(
  segment: string,
  page: EntitlementPage
): boolean {
  return page.customer_id === null
    ? segment === UNBOUND_SEGMENT
    : segment === page.customer_id
}

export function nameOf(label: string | null | undefined): string {
  return label?.trim() || adminCopy.home.newCustomer
}

// One value of a field, worded: a date DD.MM.YY, a count, the days ("כל
// הימים" for null, else "ראשון, שלישי"), the kind. Anything unexpected: "—".
export function formatFieldValue(field: string, value: unknown): string {
  if (field === "expires_on") {
    return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
      ? formatShortDate(value)
      : "—"
  }
  if (field === "units") {
    return typeof value === "number" ? String(value) : "—"
  }
  if (field === "allowed_weekdays") {
    if (value === null) return copy.allDays
    if (!Array.isArray(value)) return "—"
    const days = [...value]
      .filter((d): d is number => Number.isInteger(d) && d >= 0 && d <= 6)
      .sort((a, b) => a - b)
    return days.length === 7 || days.length === 0
      ? copy.allDays
      : days.map((d) => copy.weekdays[d]).join(", ")
  }
  if (field === "eligible_event_kind") {
    return typeof value === "string" ? (copy.kinds[value] ?? value) : "—"
  }
  return "—"
}

export type TermRow = {
  field: CorrectionField
  label: string
  value: string
  // The expiry's "(כולל הארכה)".
  note: string | null
}

export function termRows(page: EntitlementPage): TermRow[] {
  return CORRECTION_FIELDS.map((field) => ({
    field,
    label: copy.fields[field],
    value: formatFieldValue(field, currentValue(page, field)),
    note:
      field === "expires_on" && page.is_extended
        ? adminCopy.customers.card.extended
        : null,
  }))
}

export function currentValue(
  page: Pick<
    EntitlementPage,
    "expires_on" | "available" | "allowed_weekdays" | "eligible_event_kind"
  >,
  field: CorrectionField
): unknown {
  switch (field) {
    case "expires_on":
      return page.expires_on
    case "units":
      return page.available
    case "allowed_weekdays":
      return page.allowed_weekdays
    case "eligible_event_kind":
      return page.eligible_event_kind
  }
}

export function pageEntries(page: EntitlementPage): EntryLine[] {
  return entryLines(page)
}

export type HistoryItem = {
  key: string
  change: string
  who: string
  at: string
  reason: string | null
  session: string | null
  // An automatic extension: "שבוע {DD.MM}–{DD.MM} בלי בראנץ׳ מתאים".
  week: string | null
}

// The week line of an automatic extension: Sunday to Saturday of the
// week the server recorded (display only, AD-8). Anything else: null.
export function weekLine(weekStart: unknown): string | null {
  if (typeof weekStart !== "string" || !isPlainDate(weekStart)) return null
  const end = new Date(`${weekStart}T12:00:00Z`)
  end.setUTCDate(end.getUTCDate() + 6)
  try {
    return copy.historyWeek(
      formatDayMonth(weekStart),
      formatDayMonth(end.toISOString().slice(0, 10))
    )
  } catch {
    return null
  }
}

// Newest first, as the server ordered them; "{שדה}: היה {ישן}, עכשיו
// {חדש}" (never an arrow). The system's correction (story 3.14) reads
// "הארכה אוטומטית: היה {ישן}, עכשיו {חדש}" with its week (only when it
// has one; any other system correction reads as a regular one).
export function historyItems(page: EntitlementPage): HistoryItem[] {
  return page.corrections.map((c) => historyItem(c))
}

function historyItem(c: EntitlementCorrection): HistoryItem {
  const week =
    c.actor_kind === "system" && c.week_start != null
      ? weekLine(c.week_start)
      : null
  return {
    key: c.correction_id,
    change:
      week !== null
        ? copy.historyAutoExtend(
            formatFieldValue(c.field, c.old_value),
            formatFieldValue(c.field, c.new_value)
          )
        : copy.historyChange(
            copy.fields[c.field] ?? c.field,
            formatFieldValue(c.field, c.old_value),
            formatFieldValue(c.field, c.new_value)
          ),
    who: copy.historyWho(
      adminCopy.audit.actors[c.actor_kind] ?? c.actor_kind,
      formatShortDate(c.created_at)
    ),
    at: c.created_at,
    reason: c.reason?.trim() ? copy.historyReason(c.reason.trim()) : null,
    session:
      c.related_concept_name && c.related_starts_at
        ? copy.historySession(
            `${adminCopy.sessions.sessionTitle(c.related_concept_name)} ${formatSessionDate(c.related_starts_at)}`
          )
        : null,
    week,
  }
}

// The session picker of a balance fix: this card's bookings, newest first.
export type SessionOption = { value: string; label: string }

export function sessionOptions(page: EntitlementPage): SessionOption[] {
  const seen = new Set<string>()
  return page.bookings.flatMap((b) => {
    if (seen.has(b.event_id)) return []
    seen.add(b.event_id)
    return [
      {
        value: b.event_id,
        label: `${adminCopy.sessions.sessionTitle(b.concept_name)} ${formatSessionDate(b.starts_at)}`,
      },
    ]
  })
}

// The edit box's state, per field.
export type CorrectionDraft = {
  expiresOn: string
  units: string
  // Every day checked is "all days" (stored as null).
  weekdays: readonly number[]
  kind: string
}

export function draftOf(page: EntitlementPage): CorrectionDraft {
  return {
    expiresOn: page.expires_on,
    units: String(page.available),
    weekdays: page.allowed_weekdays ?? [0, 1, 2, 3, 4, 5, 6],
    kind: page.eligible_event_kind,
  }
}

// The value the RPC takes for the draft (units: the new available count, a
// whole number >= 0; weekdays: null for every day), or ready: false while
// it is not valid yet (the box says why).
export type DraftValue = { ready: true; value: unknown } | { ready: false }

export function correctionValue(
  field: CorrectionField,
  draft: CorrectionDraft
): DraftValue {
  switch (field) {
    case "expires_on":
      return /^\d{4}-\d{2}-\d{2}$/.test(draft.expiresOn)
        ? { ready: true, value: draft.expiresOn }
        : { ready: false }
    case "units": {
      const value = draft.units.trim()
      // At most 99 (the RPC refuses more).
      return /^\d{1,2}$/.test(value)
        ? { ready: true, value: Number(value) }
        : { ready: false }
    }
    case "allowed_weekdays": {
      const days = [...new Set(draft.weekdays)]
        .filter((d) => Number.isInteger(d) && d >= 0 && d <= 6)
        .sort((a, b) => a - b)
      if (days.length === 0) return { ready: false }
      return { ready: true, value: days.length === 7 ? null : days }
    }
    case "eligible_event_kind":
      return draft.kind === "regular" || draft.kind === "couple"
        ? { ready: true, value: draft.kind }
        : { ready: false }
  }
}

export type AffectedBooking = {
  bookingId: string
  eventId: string
  startsAt: string
  conceptName: string
}

export type CorrectionPlan =
  | {
      ok: true
      field: CorrectionField
      customerLabel: string
      oldValue: unknown
      newValue: unknown
      affected: AffectedBooking[]
    }
  | { ok: false; code: ErrorCode; field: string | null }

function asRecord(data: unknown): Record<string, unknown> {
  return typeof data === "object" && data !== null && !Array.isArray(data)
    ? (data as Record<string, unknown>)
    : {}
}

function text(value: unknown): string {
  return typeof value === "string" ? value : ""
}

// preview_admin_correct_entitlement's result as the dialog reads it.
export function parseCorrectionPlan(data: unknown): CorrectionPlan {
  const row = asRecord(data)
  if (row.ok !== true || !isCorrectionField(row.field)) {
    return {
      ok: false,
      code: isErrorCode(row.code) ? row.code : "SERVER_ERROR",
      field: typeof row.field === "string" ? row.field : null,
    }
  }
  const affected = Array.isArray(row.affected) ? row.affected : []
  return {
    ok: true,
    field: row.field,
    customerLabel: nameOf(text(row.customer_label)),
    oldValue: row.old_value ?? null,
    newValue: row.new_value ?? null,
    affected: affected.map((a) => {
      const r = asRecord(a)
      return {
        bookingId: text(r.booking_id),
        eventId: text(r.event_id),
        startsAt: text(r.starts_at),
        conceptName: text(r.concept_name),
      }
    }),
  }
}

// A refusal's wording: INVALID_INPUT by its field, NO_CHANGE in the page's
// words, any other code from lib/errors.
export function correctionRefusal(
  code: ErrorCode,
  field: string | null | undefined
): string | null {
  if (code === "INVALID_INPUT" && field && copy.refusal[field]) {
    return copy.refusal[field]
  }
  if (code === "NO_CHANGE") return copy.noChange
  return null
}

// The dialog's "לפני" / "אחרי" values.
export function impactValues(plan: Extract<CorrectionPlan, { ok: true }>) {
  return {
    before: formatFieldValue(plan.field, plan.oldValue),
    after: formatFieldValue(plan.field, plan.newValue),
  }
}

export function affectedLine(a: AffectedBooking): string {
  return `${adminCopy.sessions.sessionTitle(a.conceptName)} ${formatSessionDate(a.startsAt)}`
}

// Story 3.13 (user decision 2026-10-19): a card never funds a couple
// session, so a card's event kind is shown but never changed.
export function fieldEditable(field: CorrectionField, kind: string): boolean {
  return !(field === "eligible_event_kind" && kind === "card")
}

// Story 2.14: voiding a purchase recorded by mistake. The section shows
// only while the payment is approved and the entitlement active.
export function canVoid(
  page: Pick<EntitlementPage, "payment_status" | "status">
): boolean {
  return page.payment_status === "approved" && page.status === "active"
}

export function isVoided(page: Pick<EntitlementPage, "payment_status">) {
  return page.payment_status === "voided"
}

// The balance (meter, summary, entries): not for a voided purchase, whose
// released units would read as free entries; its notice says enough.
export function showsBalance(
  page: Pick<EntitlementPage, "payment_status">
): boolean {
  return !isVoided(page)
}

// After the void: "הרכישה בוטלה ב-{DD.MM.YY}" and, when Tal gave one,
// "סיבה: {reason}". Null while the purchase is not voided.
export function voidLines(
  page: Pick<EntitlementPage, "payment_status" | "voided_at" | "void_reason">
): { on: string | null; at: string | null; reason: string | null } | null {
  if (!isVoided(page)) return null
  let on: string | null = null
  if (page.voided_at) {
    try {
      on = copy.void.voidedOn(formatShortDate(page.voided_at))
    } catch {
      on = null
    }
  }
  const reason = page.void_reason?.trim()
  return {
    on,
    at: on ? page.voided_at : null,
    reason: reason ? copy.void.reasonLine(reason) : null,
  }
}

export type VoidBooking = {
  bookingId: string
  eventId: string
  startsAt: string
  conceptName: string
  partySize: number
  guestDetails: string | null
}

export type VoidPlan =
  | {
      ok: true
      paymentId: string
      kind: string
      customerLabel: string
      productName: string
      amountAgorot: number
      paidOn: string
      linkWillBeRevoked: boolean
      bookings: VoidBooking[]
    }
  | { ok: false; code: ErrorCode }

// preview_admin_void_purchase's result as the dialog reads it.
export function parseVoidPlan(data: unknown): VoidPlan {
  const row = asRecord(data)
  if (row.ok !== true) {
    return {
      ok: false,
      code: isErrorCode(row.code) ? row.code : "SERVER_ERROR",
    }
  }
  const bookings = Array.isArray(row.bookings) ? row.bookings : []
  return {
    ok: true,
    paymentId: text(row.payment_id),
    kind: text(row.kind),
    customerLabel: nameOf(text(row.customer_label)),
    productName: text(row.product_name),
    amountAgorot:
      typeof row.amount_agorot === "number" &&
      Number.isSafeInteger(row.amount_agorot)
        ? row.amount_agorot
        : 0,
    paidOn: text(row.paid_on),
    linkWillBeRevoked: row.link_will_be_revoked === true,
    bookings: bookings.map((b) => {
      const r = asRecord(b)
      const guest = typeof r.guest_details === "string" ? r.guest_details : ""
      return {
        bookingId: text(r.booking_id),
        eventId: text(r.event_id),
        startsAt: text(r.starts_at),
        conceptName: text(r.concept_name),
        partySize: r.party_size === 2 ? 2 : 1,
        guestDetails: guest.trim() || null,
      }
    }),
  }
}

// One booking the void cancels: "בראנץ׳ {concept} {date}", and for a
// couple "זוגית" with what she wrote about her partner.
export function voidBookingLine(b: VoidBooking): {
  session: string
  couple: string | null
} {
  return {
    session: `${adminCopy.sessions.sessionTitle(b.conceptName)} ${formatSessionDate(b.startsAt)}`,
    couple:
      b.partySize === 2
        ? [copy.void.couple, b.guestDetails].filter(Boolean).join(", ")
        : null,
  }
}

// The dialog's notification lines (user decision 2026-10-26): always "the
// customer gets no notification"; only a card with bookings to cancel adds
// "tell her" (she booked with it herself). Never for single, intro or
// couple: Tal placed that booking.
export function voidNotificationLines(
  plan: Pick<Extract<VoidPlan, { ok: true }>, "kind" | "bookings">
): string[] {
  return plan.kind === "card" && plan.bookings.length > 0
    ? [copy.void.noNotification, copy.void.tellCustomer]
    : [copy.void.noNotification]
}

// The meter's total after a balance fix (story 3.13): what was used,
// booked and is still free, never original_units.
export function meterTotal(
  page: Pick<EntitlementPage, "used" | "reserved" | "available">
): number {
  return page.used + page.reserved + Math.max(page.available, 0)
}
