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
  refund: { amountAgorot: number; status: string; requestedAt: string } | null
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
              }
            : null,
      },
    ]
  })
}

/**
 * A credit she can still book with: active, not funding a booking and not
 * exhausted.
 */
export function isBookableCredit(credit: MyCredit): boolean {
  return (
    credit.status === "active" && credit.reserved === null && !credit.exhausted
  )
}

/** A credit whose options all went by unused: she contacts the business. */
export function isExhaustedCredit(credit: MyCredit): boolean {
  return (
    credit.status === "active" && credit.reserved === null && credit.exhausted
  )
}

/** An open refund request (until 3.9 completes it). */
export function isOpenRefund(credit: MyCredit): boolean {
  return (
    credit.status === "refund_requested" &&
    credit.refund?.status === "requested"
  )
}

/** The options she can book now (the used one is her booking). */
export function activeOptions(credit: MyCredit): CreditOption[] {
  return credit.options.filter((o) => o.state === "active")
}
