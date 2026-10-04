import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import { customerCopy } from "@/lib/copy/customer"

import { ExpiredCardNote, nextToggletip } from "./expired-card-note"

describe("ExpiredCardNote", () => {
  it("shows the expired line with a closed toggletip button", () => {
    const html = renderToStaticMarkup(
      <ExpiredCardNote days={49} contactHref="https://wa.me/972544256456" />
    )
    expect(html).toContain(customerCopy.expiredBeforeBound)
    expect(html).toContain('aria-expanded="false"')
    expect(html).toMatch(/<p[^>]*hidden=""/)
  })

  it("has no button without the validity days", () => {
    const html = renderToStaticMarkup(
      <ExpiredCardNote days={null} contactHref={null} />
    )
    expect(html).toContain(customerCopy.expiredBeforeBound)
    expect(html).not.toContain("<button")
  })

  it("words the explanation in weeks for whole weeks, otherwise in days", () => {
    expect(customerCopy.expiredBeforeBoundInfo(49)).toMatch(/^עברו 7 שבועות /)
    expect(customerCopy.expiredBeforeBoundInfo(7)).toMatch(/^עבר שבוע /)
    expect(customerCopy.expiredBeforeBoundInfo(10)).toMatch(/^עברו 10 ימים /)
    expect(customerCopy.expiredBeforeBoundInfo(1)).toMatch(/^עבר יום /)
    expect(customerCopy.expiredBeforeBoundInfo(49)).toContain(
      customerCopy.contactPhrase
    )
  })
})

describe("nextToggletip", () => {
  const closed = { open: false, byHover: false }

  it("keeps a bubble the hover opened open on a mouse click", () => {
    const hovered = nextToggletip(closed, { type: "hover" })
    expect(hovered).toEqual({ open: true, byHover: true })
    const pinned = nextToggletip(hovered, { type: "click", pointer: "mouse" })
    expect(pinned).toEqual({ open: true, byHover: false })
    // Pinned: leaving does not close it; a second click does.
    expect(nextToggletip(pinned, { type: "leave" })).toEqual(pinned)
    expect(nextToggletip(pinned, { type: "click", pointer: "mouse" })).toEqual(
      closed
    )
  })

  it.each(["touch", "pen", ""])("toggles on a %j click", (pointer) => {
    const opened = nextToggletip(closed, { type: "click", pointer })
    expect(opened).toEqual({ open: true, byHover: false })
    expect(nextToggletip(opened, { type: "click", pointer })).toEqual(closed)
  })

  it("closes a hover bubble on leave, and any bubble on close", () => {
    const hovered = nextToggletip(closed, { type: "hover" })
    expect(nextToggletip(hovered, { type: "leave" })).toEqual(closed)
    expect(
      nextToggletip({ open: true, byHover: false }, { type: "close" })
    ).toEqual(closed)
  })
})
