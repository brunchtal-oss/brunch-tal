import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"

import { customerCopy } from "@/lib/copy/customer"

import { WaitlistPanel } from "./waitlist-panel"
import type { WaitlistState } from "./waitlist-state"

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }))
vi.mock("../actions", () => ({
  joinWaitlistAction: vi.fn(),
  leaveWaitlistAction: vi.fn(),
}))

const copy = customerCopy.waitlist

function render(state: WaitlistState, full = false) {
  return renderToStaticMarkup(
    <WaitlistPanel
      eventId="11111111-1111-4111-8111-111111111111"
      startsAt="2026-10-12T07:00:00+00:00"
      state={state}
      full={full}
    />
  )
}

describe("WaitlistPanel (story 5.6)", () => {
  it("nothing to show: renders nothing", () => {
    expect(render({ kind: "none" })).toBe("")
  })

  it("the offer: the full line and the join button, no chip", () => {
    const html = render({ kind: "offer" })
    expect(html).toContain(copy.fullOffer)
    expect(html).toContain(copy.join)
    expect(html).not.toContain(copy.chip)
    expect(html).not.toContain(copy.leave)
  })

  it("waiting: the pending chip, the explanation and the leave button", () => {
    const html = render({ kind: "waiting", taken: false })
    expect(html).toContain(copy.chip)
    expect(html).toContain(copy.explain)
    expect(html).toContain(copy.leave)
    expect(html).not.toContain(copy.join)
    expect(html).not.toContain(copy.taken)
  })

  it("waiting, arriving from the notification while still full: the place was taken", () => {
    const html = render({ kind: "waiting", taken: true })
    expect(html).toContain(copy.taken)
    expect(html.indexOf(copy.taken)).toBeLessThan(html.indexOf(copy.chip))
  })

  it("full: ends with the link to all sessions (instead of the booking panel's notice)", () => {
    for (const state of [
      { kind: "offer" } as const,
      { kind: "waiting", taken: false } as const,
    ]) {
      expect(render(state, true)).toContain(customerCopy.allSessions)
      expect(render(state)).not.toContain(customerCopy.allSessions)
    }
  })

  it("the result lines name the session's day and never Tal", () => {
    expect(copy.left("12.10")).toBe(
      "יצאת מרשימת ההמתנה למפגש ב־12.10. לא נשלח לך עדכון על המפגש הזה"
    )
    for (const text of [
      copy.fullOffer,
      copy.explain,
      copy.taken,
      copy.joined,
      copy.left("12.10"),
    ]) {
      expect(text).not.toMatch(/(^|[\s>"(])טל($|[\s.,)<])/)
    }
  })
})
