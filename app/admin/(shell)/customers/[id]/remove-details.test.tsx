import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"

import { adminCopy } from "@/lib/copy/admin"

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
}))
vi.mock("./actions", () => ({
  previewRemoveDetailsAction: vi.fn(),
  removeDetailsAction: vi.fn(),
}))

const { RemovedCard, RemoveDetails } = await import("./remove-details")
const { blockerGroups, forfeitText, parseRemovalPlan, removedProfileOf } =
  await import("./remove-details-items")

const copy = adminCopy.customers.card.remove
const CUSTOMER = "11111111-1111-4111-8111-111111111111"

const EMPTY = {
  blockers: {
    bookings: [],
    refund_requests: [],
    pending_choices: [],
    parked_purchases: [],
  },
  forfeits: { entries_left: 0, active_credits: 0 },
}

describe("the removal plan (story 4.6)", () => {
  it("parses the RPC's plan; a missing part reads as empty", () => {
    expect(parseRemovalPlan(null)).toEqual(EMPTY)
    expect(
      parseRemovalPlan({ forfeits: { entries_left: 3, active_credits: 1 } })
    ).toEqual({ ...EMPTY, forfeits: { entries_left: 3, active_credits: 1 } })
  })

  it("forfeits: entries and a credit joined with ו, one of them, or none", () => {
    const plan = (entries: number, credits: number) =>
      parseRemovalPlan({
        ...EMPTY,
        forfeits: { entries_left: entries, active_credits: credits },
      })
    expect(forfeitText(plan(3, 1))).toBe("3 כניסות וזיכוי פתוח")
    expect(forfeitText(plan(1, 0))).toBe("כניסה אחת")
    expect(forfeitText(plan(0, 2))).toBe("2 זיכויים פתוחים")
    expect(forfeitText(plan(0, 0))).toBeNull()
  })

  it("blockers: each group with its links; empty groups are skipped", () => {
    const plan = parseRemovalPlan({
      ...EMPTY,
      blockers: {
        bookings: [
          {
            booking_id: "b1",
            event_id: "e1",
            starts_at: "2026-10-23T07:00:00Z",
            concept: "שישי מיוחד",
          },
        ],
        refund_requests: [],
        pending_choices: [{ credit_id: "c1" }],
        parked_purchases: [],
      },
    })
    const groups = blockerGroups(plan, CUSTOMER)
    expect(groups.map((g) => g.title)).toEqual([
      copy.blockedBookings,
      copy.blockedChoices,
    ])
    expect(groups[0].items[0]).toMatchObject({
      href: "/admin/sessions/e1",
      text: expect.stringContaining("בראנץ׳ שישי מיוחד"),
    })
    expect(groups[1].items[0]).toEqual({
      key: "c1",
      href: `/admin/customers/${CUSTOMER}#credit-c1`,
      text: copy.choiceLine,
    })
    expect(blockerGroups(parseRemovalPlan(EMPTY), CUSTOMER)).toEqual([])
  })

  it("story 5.20: a paid purchase without a place links to לטיפול", () => {
    const groups = blockerGroups(
      parseRemovalPlan({
        ...EMPTY,
        blockers: {
          ...EMPTY.blockers,
          parked_purchases: [
            {
              entitlement_id: "en1",
              payment_id: "p1",
              event_id: "e1",
              starts_at: "2026-10-23T07:00:00Z",
              concept: "שישי מיוחד",
            },
          ],
        },
      }),
      CUSTOMER
    )
    expect(groups.map((g) => g.title)).toEqual([copy.blockedParked])
    expect(copy.blockedParked).toBe("תשלום על מפגש בלי מקום, שעוד לא סודר")
    expect(groups[0].items[0]).toMatchObject({
      key: "en1",
      href: "/admin/attention",
      text: expect.stringContaining("בראנץ׳ שישי מיוחד"),
    })
  })

  it("a refund request links to its row on the payments screen", () => {
    const groups = blockerGroups(
      parseRemovalPlan({
        ...EMPTY,
        blockers: {
          ...EMPTY.blockers,
          refund_requests: [{ id: "r1", amount_agorot: 12800 }],
        },
      }),
      CUSTOMER
    )
    expect(groups[0].title).toBe(copy.blockedRefunds)
    expect(groups[0].items[0].href).toContain("/admin/payments#")
    expect(groups[0].items[0].text).toContain("128")
  })

  it("a tombstone profile is recognised; a full card is not", () => {
    expect(
      removedProfileOf({
        id: CUSTOMER,
        anonymized_at: "2026-10-20T08:00:00Z",
        removal_pending: true,
      })
    ).toEqual({
      id: CUSTOMER,
      anonymized_at: "2026-10-20T08:00:00Z",
      removal_pending: true,
    })
    expect(removedProfileOf({ id: CUSTOMER, full_name: "Noa" })).toBeNull()
    expect(
      removedProfileOf({ anonymized_at: "2026-10-20T08:00:00Z" })
    ).toBeNull()
  })
})

describe("the card's removal parts (story 4.6)", () => {
  it("the button, no dialog until it is pressed", () => {
    const html = renderToStaticMarkup(<RemoveDetails customerId={CUSTOMER} />)
    expect(html).toContain(copy.button)
    expect(html).not.toContain(copy.checkbox)
  })

  it("a removed customer: the title and the date only; nothing to complete when closed", () => {
    const html = renderToStaticMarkup(
      <RemovedCard
        profile={{
          id: CUSTOMER,
          anonymized_at: "2026-10-20T08:00:00Z",
          removal_pending: false,
        }}
      />
    )
    expect(html).toContain(copy.tombstoneTitle)
    expect(html).toContain("הפרטים הוסרו ב-20.10.26.")
    expect(html).not.toContain(copy.complete)
  })

  it("a removal still pending: the notice and its completion", () => {
    const html = renderToStaticMarkup(
      <RemovedCard
        profile={{
          id: CUSTOMER,
          anonymized_at: "2026-10-20T08:00:00Z",
          removal_pending: true,
        }}
      />
    )
    expect(html).toContain(copy.pending)
    expect(html).toContain(copy.complete)
  })
})
