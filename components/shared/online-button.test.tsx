import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"

import { pwaCopy } from "@/lib/copy/pwa"

import { OfflineBannerView } from "./offline-banner"
import { OFFLINE_HINT_ID, OnlineButton, offlineProps } from "./online-button"

// Story 5.21: offline a write button explains, never sends.
describe("offlineProps", () => {
  it("online: adds nothing, so the caller's own props apply", () => {
    expect(offlineProps(true, { "aria-describedby": "x" })).toEqual({})
  })

  it("offline: aria-disabled, described by the banner after the caller's own", () => {
    const props = offlineProps(false, { "aria-describedby": "hint" })
    expect(props["aria-disabled"]).toBe(true)
    expect(props["aria-describedby"]).toBe(`hint ${OFFLINE_HINT_ID}`)
    expect(offlineProps(false)["aria-describedby"]).toBe(OFFLINE_HINT_ID)
  })

  it("offline: the click only cancels itself (no submit, no handler)", () => {
    const event = { preventDefault: vi.fn() }
    offlineProps(false).onClick?.(event)
    expect(event.preventDefault).toHaveBeenCalledOnce()
  })
})

describe("OnlineButton", () => {
  it("on the server it renders as online: no flash of disabled buttons", () => {
    const html = renderToStaticMarkup(
      <OnlineButton type="submit" aria-disabled>
        save
      </OnlineButton>
    )
    expect(html).toContain('aria-disabled="true"')
    expect(html).not.toContain(OFFLINE_HINT_ID)
    expect(html).not.toContain("data-offline")
  })
})

describe("OfflineBannerView", () => {
  it("is the status the buttons point at, with the hint", () => {
    const html = renderToStaticMarkup(<OfflineBannerView />)
    expect(html).toContain(`id="${OFFLINE_HINT_ID}"`)
    expect(html).toContain('role="status"')
    expect(html).toContain(pwaCopy.offlineHint)
  })
})
