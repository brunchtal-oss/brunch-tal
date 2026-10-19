import { describe, expect, it } from "vitest"

import { adminCopy } from "@/lib/copy/admin"

import {
  changeDiff,
  creditRefusal,
  parseCreditCandidates,
  parseCreditChangePlan,
  parseCreditRefundPlan,
  parseCustomerCredits,
  pickProblem,
  toCustomerCreditItem,
} from "./credit-items"

const credits = adminCopy.customers.card.credits
const chips = credits.chips

const BASE = {
  credit_id: "c1",
  status: "active",
  choice_pending: false,
  party_size: 1,
  origin_starts_at: "2026-10-16T07:00:00Z",
  concept_name: "שישי מיוחד",
  monetary_basis_agorot: 18000,
  refund: null,
}

const REFUND = {
  refund_request_id: "r1",
  status: "requested",
  amount_agorot: 18000,
  requested_at: "2026-10-10T07:00:00Z",
  refunded_on: null,
  reference: null,
}

function item(extra: Record<string, unknown>) {
  const [row] = parseCustomerCredits([{ ...BASE, ...extra }])
  return toCustomerCreditItem(row)
}

const flat = (text: string) => text.replace(/\s/g, " ")

describe("parseCustomerCredits (story 3.9)", () => {
  it("keeps well-formed rows, a refund only when whole; skips the rest", () => {
    const rows = parseCustomerCredits([
      BASE,
      { ...BASE, credit_id: "c2", refund: REFUND },
      { ...BASE, credit_id: "c3", refund: { ...REFUND, status: "x" } },
      { ...BASE, credit_id: null },
      { ...BASE, status: "expired" },
      "x",
    ])
    expect(rows.map((r) => r.credit_id)).toEqual(["c1", "c2", "c3"])
    expect(rows[1].refund).toEqual(REFUND)
    expect(rows[2].refund).toBeNull()
    expect(parseCustomerCredits(null)).toEqual([])
  })
})

describe("toCustomerCreditItem", () => {
  it("an active credit: זיכוי פעיל and its worth", () => {
    const i = item({})
    expect(flat(i.title)).toBe("בראנץ׳ שישי מיוחד 16.10")
    expect(i.chip).toEqual({ label: chips.active, tone: "success" })
    expect(flat(i.line)).toBe("זיכוי בשווי 180 ₪")
    expect(i.openRefundId).toBeNull()
    expect(i.couple).toBe(false)
  })

  it("a used credit and a pending choice", () => {
    expect(item({ status: "used" }).chip).toEqual({
      label: chips.used,
      tone: "expired",
    })
    const pending = item({ choice_pending: true, party_size: 2 })
    expect(pending.chip.label).toBe(chips.pending)
    expect(pending.couple).toBe(true)
    expect(pending.openRefundId).toBeNull()
  })

  it("an open refund request: בקשת החזר and the complete button's request", () => {
    const i = item({ status: "refund_requested", refund: REFUND })
    expect(i.chip).toEqual({ label: chips.requested, tone: "pending" })
    expect(flat(i.line)).toBe("ביקשה החזר של 180 ₪ ב-10.10")
    expect(i.openRefundId).toBe("r1")
    expect(i.line).not.toContain("הוחזר")
  })

  it("a refunded one: הוחזר, amount, day and reference; no button", () => {
    const i = item({
      status: "refunded",
      refund: {
        ...REFUND,
        status: "completed",
        amount_agorot: 12000,
        refunded_on: "2026-10-12",
        reference: "1234",
      },
    })
    expect(i.chip).toEqual({ label: chips.refunded, tone: "success" })
    expect(flat(i.line)).toBe("הוחזר 120 ₪ ב-12.10.26")
    expect(i.reference).toBe("אסמכתה: 1234")
    expect(i.openRefundId).toBeNull()
  })
})

// Story 3.16: alternatives and Tal's actions.
const OPTION = {
  event_id: "e1",
  starts_at: "2026-10-26T07:00:00Z",
  concept_name: "אמהות",
  state: "active",
  added_by: "admin",
}

describe("an active credit's alternatives and actions (story 3.16)", () => {
  it("lists the active alternatives only and offers both actions", () => {
    const i = item({
      options: [
        OPTION,
        { ...OPTION, event_id: "e0", state: "passed" },
        { ...OPTION, event_id: "e2", state: "x" },
      ],
      options_count: 2,
      in_use: false,
      exhausted: false,
    })
    expect(i.options.map((o) => o.key)).toEqual(["e1"])
    expect(flat(i.options[0].line)).toBe("בראנץ׳ אמהות · יום שני 26.10")
    expect(i.manage).toEqual({
      change: true,
      refund: true,
      note: null,
      inUse: null,
    })
  })

  it("exhausted: both actions and the hint to add sessions", () => {
    const i = item({ options: [], exhausted: true })
    expect(i.manage).toEqual({
      change: true,
      refund: true,
      note: credits.exhausted,
      inUse: null,
    })
  })

  it("in use: no alternatives, no actions; its session links to the session page", () => {
    const i = item({
      options: [OPTION],
      in_use: true,
      in_use_booking: {
        booking_id: "b9",
        event_id: "ev9",
        starts_at: "2026-10-26T07:00:00Z",
        concept_name: "אמהות",
      },
    })
    expect(i.options).toEqual([])
    expect(i.manage).toMatchObject({
      change: false,
      refund: false,
      note: null,
      inUse: {
        href: "/admin/sessions/ev9",
        startsAt: "2026-10-26T07:00:00Z",
      },
    })
    expect(flat(i.manage!.inUse!.line)).toBe("בראנץ׳ אמהות · יום שני 26.10")
  })

  it("in use without its booking row: the general sentence", () => {
    const i = item({ in_use: true, in_use_booking: { booking_id: "b9" } })
    expect(i.manage).toEqual({
      change: false,
      refund: false,
      note: credits.inUse,
      inUse: null,
    })
  })

  it("a pending choice: refund only; nothing for a used or refunded one", () => {
    expect(item({ choice_pending: true }).manage).toEqual({
      change: false,
      refund: true,
      note: null,
      inUse: null,
    })
    expect(item({ status: "used" }).manage).toBeNull()
    expect(item({ status: "refund_requested", refund: REFUND }).manage).toBe(
      null
    )
  })
})

describe("changeDiff (phone check 2026-10-20)", () => {
  const s = (id: string) => ({ eventId: id, startsAt: "s", conceptName: "c" })

  it("added: in after only; removed: in before only", () => {
    expect(
      changeDiff({ before: [s("a"), s("b")], after: [s("b"), s("c")] })
    ).toEqual({ added: [s("c")], removed: [s("a")] })
  })

  it("only additions (an extension), or only removals", () => {
    expect(changeDiff({ before: [s("a")], after: [s("a"), s("d")] })).toEqual({
      added: [s("d")],
      removed: [],
    })
    expect(changeDiff({ before: [s("a"), s("b")], after: [s("a")] })).toEqual({
      added: [],
      removed: [s("b")],
    })
  })
})

describe("the plans and the candidates (story 3.16)", () => {
  it("candidates keep whole rows with is_option", () => {
    expect(
      parseCreditCandidates([
        { event_id: "e1", starts_at: "s", concept_name: "c", is_option: true },
        { event_id: "e2", starts_at: "s" },
        { event_id: null },
        "x",
      ])
    ).toEqual([
      { eventId: "e1", startsAt: "s", conceptName: "c", isOption: true },
      { eventId: "e2", startsAt: "s", conceptName: "", isOption: false },
    ])
    expect(parseCreditCandidates(null)).toEqual([])
  })

  it("the change plan: before and after; a refusal keeps its code and field", () => {
    expect(
      parseCreditChangePlan({
        ok: true,
        customer_label: "נועה",
        before: [{ event_id: "a", starts_at: "s", concept_name: "c" }],
        after: [],
      })
    ).toEqual({
      ok: true,
      customerLabel: "נועה",
      before: [{ eventId: "a", startsAt: "s", conceptName: "c" }],
      after: [],
    })
    expect(
      parseCreditChangePlan({
        ok: false,
        code: "INVALID_INPUT",
        field: "events",
      })
    ).toEqual({ ok: false, code: "INVALID_INPUT", field: "events" })
    expect(parseCreditChangePlan({ ok: false, code: "WHAT" })).toEqual({
      ok: false,
      code: "SERVER_ERROR",
      field: null,
    })
  })

  it("the refund plan: the amount, or the refusal", () => {
    expect(
      parseCreditRefundPlan({
        ok: true,
        customer_label: "נועה",
        amount_agorot: 18000,
      })
    ).toEqual({ ok: true, customerLabel: "נועה", amountAgorot: 18000 })
    expect(
      parseCreditRefundPlan({ ok: false, code: "CREDIT_NOT_ACTIVE" })
    ).toEqual({ ok: false, code: "CREDIT_NOT_ACTIVE", field: null })
  })

  it("1 to 10 sessions; the refusal wording by field", () => {
    expect(pickProblem([])).toBe(credits.pickOne)
    expect(pickProblem(["a"])).toBeNull()
    expect(pickProblem(Array.from({ length: 11 }, (_, n) => `e${n}`))).toBe(
      credits.pickMax
    )
    expect(creditRefusal("INVALID_INPUT", "events")).toBe(
      credits.refusal.events
    )
    expect(creditRefusal("NO_CHANGE", null)).toBe(credits.noChange)
    expect(creditRefusal("CREDIT_IN_USE", null)).toBeNull()
  })
})
