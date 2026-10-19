import type { StatusTone } from "@/components/shared/status-chip"
import { adminCopy } from "@/lib/copy/admin"
import { formatAgorot } from "@/lib/money"
import { isErrorCode, type ErrorCode } from "@/lib/errors"
import { formatDayMonth, formatSessionDate, formatShortDate } from "@/lib/time"

// The "זיכויים והחזרים" section of the customer card (story 3.9), from
// admin_list_customer_credits (pure: data in, items out). Every state and
// amount is the server's; this file only picks the chip and the line.
// Story 3.16: an active credit's alternatives, which of Tal's two actions
// it offers, and the parsers of their reads and plans.

const copy = adminCopy.customers.card.credits

export type CustomerCreditRow = {
  credit_id: string
  status: "active" | "used" | "refund_requested" | "refunded"
  choice_pending: boolean
  party_size: number
  origin_starts_at: string
  concept_name: string
  monetary_basis_agorot: number
  refund: {
    refund_request_id: string
    status: "requested" | "completed"
    amount_agorot: number
    requested_at: string
    refunded_on: string | null
    reference: string | null
  } | null
  // Story 3.16 (admin_list_customer_credits): the active, used and passed
  // alternatives; it funds a confirmed booking; none left to book.
  options: CreditOptionRow[]
  options_count: number
  in_use: boolean
  exhausted: boolean
  // The confirmed booking the credit funds (phone check 2026-10-20).
  in_use_booking: {
    booking_id: string
    event_id: string
    starts_at: string
    concept_name: string
  } | null
}

export type CreditOptionRow = {
  event_id: string
  starts_at: string
  concept_name: string
  state: "active" | "used" | "passed"
  added_by: "system" | "admin"
}

export type CreditOptionLine = { key: string; line: string; startsAt: string }

// What Tal can do with the credit (story 3.16): change its alternatives
// (active, not in use, not waiting for her choice) and refund it (active,
// not in use); note: why not, or that every alternative passed; inUse: the
// session the credit funds, a link to its admin page (the note is then
// null). null: not an active credit.
export type CreditManage = {
  change: boolean
  refund: boolean
  note: string | null
  inUse: { href: string; line: string; startsAt: string } | null
}

export type CustomerCreditItem = {
  key: string
  title: string
  couple: boolean
  chip: { label: string; tone: StatusTone }
  line: string
  reference: string | null
  // An open refund request: the complete button acts on it.
  openRefundId: string | null
  // Story 3.16: the active alternatives (by date) and the actions.
  options: CreditOptionLine[]
  manage: CreditManage | null
}

const STATUSES = ["active", "used", "refund_requested", "refunded"] as const
const OPTION_STATES = ["active", "used", "passed"] as const

const str = (v: unknown): string | null => (typeof v === "string" ? v : null)
const int = (v: unknown): number | null =>
  typeof v === "number" && Number.isSafeInteger(v) ? v : null
const obj = (v: unknown): Record<string, unknown> | null =>
  typeof v === "object" && v !== null && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null

function parseRefund(value: unknown): CustomerCreditRow["refund"] {
  const r = obj(value)
  const id = str(r?.refund_request_id)
  const amount = int(r?.amount_agorot)
  if (
    !r ||
    !id ||
    amount === null ||
    (r.status !== "requested" && r.status !== "completed")
  ) {
    return null
  }
  return {
    refund_request_id: id,
    status: r.status,
    amount_agorot: amount,
    requested_at: str(r.requested_at) ?? "",
    refunded_on: str(r.refunded_on),
    reference: str(r.reference),
  }
}

function parseOptions(value: unknown): CreditOptionRow[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((raw): CreditOptionRow[] => {
    const o = obj(raw)
    const eventId = str(o?.event_id)
    const startsAt = str(o?.starts_at)
    const state = OPTION_STATES.find((s) => s === o?.state)
    if (!o || !eventId || !startsAt || !state) return []
    return [
      {
        event_id: eventId,
        starts_at: startsAt,
        concept_name: str(o.concept_name) ?? "",
        state,
        added_by: o.added_by === "admin" ? "admin" : "system",
      },
    ]
  })
}

function parseInUseBooking(
  value: unknown
): CustomerCreditRow["in_use_booking"] {
  const b = obj(value)
  const bookingId = str(b?.booking_id)
  const eventId = str(b?.event_id)
  const startsAt = str(b?.starts_at)
  if (!b || !bookingId || !eventId || !startsAt) return null
  return {
    booking_id: bookingId,
    event_id: eventId,
    starts_at: startsAt,
    concept_name: str(b.concept_name) ?? "",
  }
}

// An in-use credit: why it cannot change, with its session as a link to
// the session's admin page (where the booking is cancelled) when known.
function inUseManage(row: CustomerCreditRow): CreditManage {
  const booking = row.in_use_booking
  return booking
    ? {
        change: false,
        refund: false,
        note: null,
        inUse: {
          href: `/admin/sessions/${encodeURIComponent(booking.event_id)}`,
          line: optionLine(booking.concept_name, booking.starts_at),
          startsAt: booking.starts_at,
        },
      }
    : { change: false, refund: false, note: copy.inUse, inUse: null }
}

/** admin_list_customer_credits' jsonb; a malformed row is left out. */
export function parseCustomerCredits(data: unknown): CustomerCreditRow[] {
  if (!Array.isArray(data)) return []
  return data.flatMap((raw): CustomerCreditRow[] => {
    const r = obj(raw)
    const id = str(r?.credit_id)
    const startsAt = str(r?.origin_starts_at)
    const status = STATUSES.find((s) => s === r?.status)
    if (!r || !id || !startsAt || !status) return []
    return [
      {
        credit_id: id,
        status,
        choice_pending: r.choice_pending === true,
        party_size: r.party_size === 2 ? 2 : 1,
        origin_starts_at: startsAt,
        concept_name: str(r.concept_name) ?? "",
        monetary_basis_agorot: int(r.monetary_basis_agorot) ?? 0,
        refund: parseRefund(r.refund),
        options: parseOptions(r.options),
        options_count: int(r.options_count) ?? 0,
        in_use: r.in_use === true,
        exhausted: r.exhausted === true,
        in_use_booking: parseInUseBooking(r.in_use_booking),
      },
    ]
  })
}

export function toCustomerCreditItem(
  row: CustomerCreditRow
): CustomerCreditItem {
  const base = {
    key: row.credit_id,
    title: copy.sessionTitle(
      row.concept_name,
      formatDayMonth(row.origin_starts_at)
    ),
    couple: row.party_size === 2,
    reference: null,
    openRefundId: null,
    options: [] as CreditOptionLine[],
    manage: null as CreditManage | null,
  }
  const refund = row.refund
  if (row.status === "refunded" && refund) {
    return {
      ...base,
      chip: { label: copy.chips.refunded, tone: "success" },
      line: copy.refundedLine(
        formatAgorot(refund.amount_agorot),
        refund.refunded_on ? formatShortDate(refund.refunded_on) : ""
      ),
      reference: refund.reference ? copy.reference(refund.reference) : null,
    }
  }
  if (row.status === "refund_requested" && refund) {
    return {
      ...base,
      chip: { label: copy.chips.requested, tone: "pending" },
      line: copy.requestedLine(
        formatAgorot(refund.amount_agorot),
        refund.requested_at ? formatDayMonth(refund.requested_at) : ""
      ),
      openRefundId:
        refund.status === "requested" ? refund.refund_request_id : null,
    }
  }
  if (row.status === "active" && row.choice_pending) {
    return {
      ...base,
      chip: { label: copy.chips.pending, tone: "warning" },
      line: copy.pendingLine,
      // A refund closes her choice (user decision 2026-10-19).
      manage: row.in_use
        ? inUseManage(row)
        : { change: false, refund: true, note: null, inUse: null },
    }
  }
  if (row.status === "used") {
    return {
      ...base,
      chip: { label: copy.chips.used, tone: "expired" },
      line: copy.worth(formatAgorot(row.monetary_basis_agorot)),
    }
  }
  return {
    ...base,
    chip: { label: copy.chips.active, tone: "success" },
    line: copy.worth(formatAgorot(row.monetary_basis_agorot)),
    options: row.in_use
      ? []
      : row.options
          .filter((o) => o.state === "active")
          .map((o) => ({
            key: o.event_id,
            line: optionLine(o.concept_name, o.starts_at),
            startsAt: o.starts_at,
          })),
    manage: row.in_use
      ? inUseManage(row)
      : {
          change: true,
          refund: true,
          note: row.exhausted ? copy.exhausted : null,
          inUse: null,
        },
  }
}

// "בראנץ׳ {concept} · {weekday} {DD.MM}".
export function optionLine(conceptName: string, startsAt: string): string {
  return copy.optionLine(conceptName, formatSessionDate(startsAt))
}

// ---------------------------------------------------------------------------
// Story 3.16: the edit box's sessions and the two plans
// ---------------------------------------------------------------------------

export const MAX_CREDIT_OPTIONS = 10

export type CreditSession = {
  eventId: string
  startsAt: string
  conceptName: string
}

export type CreditCandidate = CreditSession & { isOption: boolean }

function sessionOf(raw: unknown): CreditSession | null {
  const r = obj(raw)
  const eventId = str(r?.event_id)
  const startsAt = str(r?.starts_at)
  if (!r || !eventId || !startsAt) return null
  return { eventId, startsAt, conceptName: str(r.concept_name) ?? "" }
}

function sessionsOf(value: unknown): CreditSession[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((raw) => {
    const s = sessionOf(raw)
    return s ? [s] : []
  })
}

/** admin_list_credit_candidates' jsonb; a malformed row is left out. */
export function parseCreditCandidates(data: unknown): CreditCandidate[] {
  if (!Array.isArray(data)) return []
  return data.flatMap((raw): CreditCandidate[] => {
    const s = sessionOf(raw)
    return s ? [{ ...s, isOption: obj(raw)?.is_option === true }] : []
  })
}

type Refusal = { ok: false; code: ErrorCode; field: string | null }

export type CreditChangePlan =
  | {
      ok: true
      customerLabel: string
      before: CreditSession[]
      after: CreditSession[]
    }
  | Refusal

export type CreditRefundPlan =
  { ok: true; customerLabel: string; amountAgorot: number } | Refusal

function refusalOf(r: Record<string, unknown> | null): Refusal {
  const code = r?.code
  return {
    ok: false,
    code: isErrorCode(code) ? code : "SERVER_ERROR",
    field: str(r?.field),
  }
}

/** preview_admin_change_credit_options' jsonb. */
export function parseCreditChangePlan(data: unknown): CreditChangePlan {
  const r = obj(data)
  if (r?.ok !== true) return refusalOf(r)
  return {
    ok: true,
    customerLabel: str(r.customer_label) ?? "",
    before: sessionsOf(r.before),
    after: sessionsOf(r.after),
  }
}

/** preview_admin_refund_credit's jsonb. */
export function parseCreditRefundPlan(data: unknown): CreditRefundPlan {
  const r = obj(data)
  const amount = int(r?.amount_agorot)
  if (r?.ok !== true || amount === null) return refusalOf(r)
  return {
    ok: true,
    customerLabel: str(r.customer_label) ?? "",
    amountAgorot: amount,
  }
}

// The change dialog's rows (phone check 2026-10-20): the sessions the
// change adds (in after, not in before) and those it removes (in before,
// not in after), each by date as the plan lists them.
export function changeDiff(plan: {
  before: readonly CreditSession[]
  after: readonly CreditSession[]
}): { added: CreditSession[]; removed: CreditSession[] } {
  const was = new Set(plan.before.map((s) => s.eventId))
  const will = new Set(plan.after.map((s) => s.eventId))
  return {
    added: plan.after.filter((s) => !was.has(s.eventId)),
    removed: plan.before.filter((s) => !will.has(s.eventId)),
  }
}

// The checked sessions: 1 to 10, else why not.
export function pickProblem(eventIds: readonly string[]): string | null {
  if (eventIds.length === 0) return copy.pickOne
  if (eventIds.length > MAX_CREDIT_OPTIONS) return copy.pickMax
  return null
}

// A refusal's wording: INVALID_INPUT by its field, NO_CHANGE in the
// section's words; null: the code's message from lib/errors.
export function creditRefusal(
  code: ErrorCode,
  field: string | null | undefined
): string | null {
  if (code === "INVALID_INPUT" && field && copy.refusal[field]) {
    return copy.refusal[field]
  }
  if (code === "NO_CHANGE") return copy.noChange
  return null
}
