import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"

import { adminCopy } from "@/lib/copy/admin"
import { errorMessage } from "@/lib/errors"
import { SENSITIVE_ACTIONS } from "@/lib/admin/sensitive-actions"

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}))

const { creditsNotice, deleteImpactRows, offersCancel, SessionDelete } =
  await import("./session-delete")
const { parseDeleteEventPlan, parseHiddenPaths } = await import("./event-plan")
const { CANCEL_ANCHOR, isCancelHash } = await import("./session-cancel")

const copy = adminCopy.sessions.deleteEvent
const ID = "55555555-5555-4555-8555-555555555555"

describe("parseDeleteEventPlan (story 3.17)", () => {
  it("the counts of a ready plan; anything missing is 0", () => {
    expect(
      parseDeleteEventPlan({
        ok: true,
        work_dishes_count: 2,
        work_tasks_count: 5,
        shopping_items_count: 1,
        credit_count: 3,
        credit_options: [],
      })
    ).toEqual({
      ok: true,
      dishCount: 2,
      taskCount: 5,
      shoppingCount: 1,
      creditCount: 3,
    })
    expect(parseDeleteEventPlan({ ok: true })).toEqual({
      ok: true,
      dishCount: 0,
      taskCount: 0,
      shoppingCount: 0,
      creditCount: 0,
    })
  })

  it("a refusal keeps its code; an unknown one is SERVER_ERROR", () => {
    expect(
      parseDeleteEventPlan({ ok: false, code: "EVENT_HAS_PURCHASES" })
    ).toEqual({ ok: false, code: "EVENT_HAS_PURCHASES", field: null })
    expect(parseDeleteEventPlan({ ok: false, code: "NOPE" })).toMatchObject({
      code: "SERVER_ERROR",
    })
  })

  it("hidden_paths: strings only", () => {
    expect(
      parseHiddenPaths({ event_id: ID, hidden_paths: ["a.jpg", 3, null] })
    ).toEqual(["a.jpg"])
    expect(parseHiddenPaths({ event_id: ID, hidden_paths: null })).toEqual([])
  })
})

describe("the delete dialog's content (story 3.17)", () => {
  it("the session, then only the work sheet counts above 0; no credits row", () => {
    const rows = deleteImpactRows(
      {
        ok: true,
        dishCount: 2,
        taskCount: 0,
        shoppingCount: 4,
        creditCount: 1,
      },
      "יום כיף",
      "2026-10-22T07:00:00+00:00"
    )
    expect(rows.map((row) => row.label)).toEqual([
      copy.session,
      copy.dishes,
      copy.shopping,
    ])
  })

  it("the credits notice: two sentences, by count; none without credits", () => {
    expect(creditsNotice(0)).toBeNull()
    const one = renderToStaticMarkup(<>{creditsNotice(1)}</>)
    expect(one).toContain("המפגש מוצע כחלופה ללקוחות שקיבלו זיכוי.")
    expect(one).toContain("לקוחה אחת תקבל מפגש חלופי אחר.")
    expect(renderToStaticMarkup(<>{creditsNotice(3)}</>)).toContain(
      "3 לקוחות יקבלו מפגש חלופי אחר."
    )
  })

  it("a draft with nothing on it: only the session", () => {
    const rows = deleteImpactRows(
      {
        ok: true,
        dishCount: 0,
        taskCount: 0,
        shoppingCount: 0,
        creditCount: 0,
      },
      "יום כיף",
      "2026-10-22T07:00:00+00:00"
    )
    expect(rows).toHaveLength(1)
  })

  it("the cancel opens only for its own hash", () => {
    expect(CANCEL_ANCHOR).toBe("cancel-event")
    expect(isCancelHash("#cancel-event")).toBe(true)
    expect(isCancelHash("")).toBe(false)
    expect(isCancelHash("#cancel-event-2")).toBe(false)
    expect(isCancelHash("cancel-event")).toBe(false)
  })

  it("the cancel link only with bookings while the session can be cancelled", () => {
    expect(offersCancel("EVENT_HAS_BOOKINGS", true)).toBe(true)
    // A draft, or a published session that already started.
    expect(offersCancel("EVENT_HAS_BOOKINGS", false)).toBe(false)
    expect(offersCancel("EVENT_HAS_PURCHASES", true)).toBe(false)
  })

  it("the button, the question and the refusals' wording", () => {
    const html = renderToStaticMarkup(
      <SessionDelete
        eventId={ID}
        conceptName="יום כיף"
        startsAt="2026-10-22T07:00:00+00:00"
        cancellable={false}
      />
    )
    expect(html).toContain(copy.button)
    expect(SENSITIVE_ACTIONS.event_delete).toBe("האם למחוק את המפגש?")
    expect(errorMessage("EVENT_HAS_BOOKINGS")).toBe(
      "אי אפשר למחוק מפגש שיש בו הרשמות, גם הרשמה שבוטלה, כי היא שומרת את ההיסטוריה של הלקוחה."
    )
    expect(errorMessage("EVENT_NOT_DELETABLE")).toBe(
      "אי אפשר למחוק מפגש שהסתיים או בוטל. הוא נשאר בהיסטוריה."
    )
  })
})
