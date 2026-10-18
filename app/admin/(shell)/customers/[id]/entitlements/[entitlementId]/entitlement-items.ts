import { adminCopy } from "@/lib/copy/admin"
import { isErrorCode, type ErrorCode } from "@/lib/errors"
import { formatSessionDate, formatShortDate } from "@/lib/time"

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
}

export type EntitlementPage = {
  entitlement_id: string
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
}

// Newest first, as the server ordered them; "{שדה}: היה {ישן}, עכשיו
// {חדש}" (never an arrow).
export function historyItems(page: EntitlementPage): HistoryItem[] {
  return page.corrections.map((c) => ({
    key: c.correction_id,
    change: copy.historyChange(
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
  }))
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

// The meter's total after a balance fix (story 3.13): what was used,
// booked and is still free, never original_units.
export function meterTotal(
  page: Pick<EntitlementPage, "used" | "reserved" | "available">
): number {
  return page.used + page.reserved + Math.max(page.available, 0)
}
