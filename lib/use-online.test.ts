import { afterEach, describe, expect, it, vi } from "vitest"

import { isOffline, subscribe } from "./use-online"

// Story 5.21: the buttons follow the network both ways, without a reload.
describe("useOnline's store", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("listens to offline and online, and stops on unsubscribe", () => {
    const target = new EventTarget()
    vi.stubGlobal("window", target)
    const onChange = vi.fn()
    const unsubscribe = subscribe(onChange)

    target.dispatchEvent(new Event("offline"))
    target.dispatchEvent(new Event("online"))
    expect(onChange).toHaveBeenCalledTimes(2)

    unsubscribe()
    target.dispatchEvent(new Event("online"))
    expect(onChange).toHaveBeenCalledTimes(2)
  })

  it("isOffline: only an explicit false is offline", () => {
    vi.stubGlobal("navigator", { onLine: false })
    expect(isOffline()).toBe(true)
    vi.stubGlobal("navigator", { onLine: true })
    expect(isOffline()).toBe(false)
  })
})
