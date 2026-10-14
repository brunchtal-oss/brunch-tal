// Her cancellation credits and refund requests (story 3.7), from
// get_my_credits' jsonb (pure: data in, values out). The server refreshed
// the options before answering and decided every value (the options, the
// waiting state, the refund); nothing is computed from a clock here (AD-8).

export type CreditOption = {
  eventId: string
  startsAt: string
  conceptName: string
  state: "active" | "used"
}

export type MyCredit = {
  creditId: string
  status: "active" | "refund_requested" | "refunded"
  partySize: number
  originStartsAt: string
  originConceptName: string
  // The confirmed booking it funds, or null.
  reserved: { bookingId: string; eventId: string; startsAt: string } | null
  options: CreditOption[]
  // No active option and fewer than N so far: the next sessions are not
  // published yet.
  waiting: boolean
  // No active option and all N went by unused (user decision 2026-10-10).
  exhausted: boolean
  // amountAgorot: requested, or refunded once completed (3.9);
  // refundedOn: the day Tal paid it, null while requested.
  refund: {
    amountAgorot: number
    status: string
    requestedAt: string
    refundedOn: string | null
  } | null
  // Story 3.8: the business cancelled the session; she chooses refund or
  // credit (no options until she does, no deadline).
  choicePending: boolean
  // The start of the session whose cancel made the credit what it is now
  // (the origin, or a later session it funded); null when unknown.
  cancelledStartsAt: string | null
  // N: the number of next sessions a credit lets her choose from.
  optionsCount: number
}

const STATUSES = ["active", "refund_requested", "refunded"] as const

const str = (v: unknown): string | null => (typeof v === "string" ? v : null)
const obj = (v: unknown): Record<string, unknown> | null =>
  typeof v === "object" && v !== null && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null

function parseOptions(value: unknown): CreditOption[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((raw): CreditOption[] => {
    const r = obj(raw)
    const eventId = str(r?.event_id)
    const startsAt = str(r?.starts_at)
    if (!r || !eventId || !startsAt) return []
    if (r.state !== "active" && r.state !== "used") return []
    return [
      {
        eventId,
        startsAt,
        conceptName: str(r.concept_name) ?? "",
        state: r.state,
      },
    ]
  })
}

/** get_my_credits' jsonb; a malformed row is left out. */
export function parseMyCredits(data: unknown): MyCredit[] {
  if (!Array.isArray(data)) return []
  return data.flatMap((raw): MyCredit[] => {
    const r = obj(raw)
    const creditId = str(r?.credit_id)
    const originStartsAt = str(r?.origin_starts_at)
    const status = STATUSES.find((s) => s === r?.status)
    if (!r || !creditId || !originStartsAt || !status) return []
    const reserved = obj(r.reserved_booking)
    const reservedBooking = str(reserved?.booking_id)
    const reservedEvent = str(reserved?.event_id)
    const reservedStarts = str(reserved?.starts_at)
    const refund = obj(r.refund)
    const amount = refund?.amount_agorot
    return [
      {
        creditId,
        status,
        partySize: r.party_size === 2 ? 2 : 1,
        originStartsAt,
        originConceptName: str(r.origin_concept_name) ?? "",
        reserved:
          reservedBooking && reservedEvent && reservedStarts
            ? {
                bookingId: reservedBooking,
                eventId: reservedEvent,
                startsAt: reservedStarts,
              }
            : null,
        options: parseOptions(r.options),
        waiting: r.waiting === true,
        exhausted: r.exhausted === true,
        refund:
          refund && typeof amount === "number" && Number.isInteger(amount)
            ? {
                amountAgorot: amount,
                status: str(refund.status) ?? "",
                requestedAt: str(refund.requested_at) ?? "",
                refundedOn: str(refund.refunded_on),
              }
            : null,
        choicePending: r.choice_pending === true,
        cancelledStartsAt: str(r.cancelled_starts_at),
        optionsCount:
          typeof r.options_count === "number" &&
          Number.isInteger(r.options_count) &&
          r.options_count > 0
            ? r.options_count
            : 1,
      },
    ]
  })
}

/**
 * A credit she can still book with: active, chosen (not waiting for her
 * refund-or-credit choice), not funding a booking and not exhausted.
 */
export function isBookableCredit(credit: MyCredit): boolean {
  return (
    credit.status === "active" &&
    !credit.choicePending &&
    credit.reserved === null &&
    !credit.exhausted
  )
}

/** A credit whose options all went by unused: she contacts the business. */
export function isExhaustedCredit(credit: MyCredit): boolean {
  return (
    credit.status === "active" &&
    !credit.choicePending &&
    credit.reserved === null &&
    credit.exhausted
  )
}

/**
 * A business cancel waiting for her choice (story 3.8): the card at the top
 * of home and of her bookings until she chooses.
 */
export function isPendingChoice(credit: MyCredit): boolean {
  return credit.status === "active" && credit.choicePending
}

/** DD.MM source of the pending card's title: the cancelled session. */
export function pendingChoiceStartsAt(credit: MyCredit): string {
  return credit.cancelledStartsAt ?? credit.originStartsAt
}

/** An open refund request (until Tal completes it, 3.9). */
export function isOpenRefund(credit: MyCredit): boolean {
  return (
    credit.status === "refund_requested" &&
    credit.refund?.status === "requested"
  )
}

/**
 * A refund Tal recorded (story 3.9): the server returns it for 14 days
 * after its date, then only the purchase chip remains.
 */
export function isRefunded(credit: MyCredit): boolean {
  return (
    credit.status === "refunded" &&
    credit.refund?.status === "completed" &&
    credit.refund.refundedOn !== null
  )
}

/** The options she can book now (the used one is her booking). */
export function activeOptions(credit: MyCredit): CreditOption[] {
  return credit.options.filter((o) => o.state === "active")
}
