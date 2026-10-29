import { renderToStaticMarkup } from "react-dom/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { shellCopy } from "@/lib/copy/shell"

import {
  AccessibilityButton,
  AccessibilityButtonView,
  openWidget,
  syncWidgetWithPath,
  type WidgetDeps,
} from "./accessibility-button"

const path = vi.hoisted(() => ({ current: "/" }))
vi.mock("next/navigation", () => ({ usePathname: () => path.current }))

// The library itself is never imported in these tests.
const importLibrary = vi.hoisted(() => vi.fn())
vi.mock("accessible-web-widget", () => {
  importLibrary()
  return { default: {} }
})

function deps(over: Partial<WidgetDeps> = {}): WidgetDeps {
  return {
    load: vi.fn(async () => ({
      open: vi.fn(() => true),
      close() {},
      toggle() {},
    })),
    requested: vi.fn(() => false),
    saved: vi.fn(() => false),
    reload: vi.fn(),
    ...over,
  }
}

describe("AccessibilityButton", () => {
  it.each(["/", "/sessions", "/login", "/me", "/join/x", "/offline"])(
    "is shown on %s",
    (url) => {
      path.current = url
      expect(renderToStaticMarkup(<AccessibilityButton />)).toContain(
        "data-a11y-button"
      )
    }
  )

  it.each(["/admin", "/admin/login", "/admin/sessions"])(
    "is not shown on %s",
    (url) => {
      path.current = url
      expect(renderToStaticMarkup(<AccessibilityButton />)).toBe("")
    }
  )
})

describe("AccessibilityButtonView", () => {
  const html = renderToStaticMarkup(<AccessibilityButtonView />)

  it("a native button with its name and popup", () => {
    expect(html).toMatch(/^<button type="button"/)
    expect(html).toContain(`aria-label="${shellCopy.accessibilityButton}"`)
    expect(html).toContain('aria-haspopup="dialog"')
    expect(html).not.toContain("aria-busy")
  })

  it("fixed at the end, 48px round, olive, flat, not printed", () => {
    for (const cls of [
      "fixed",
      "end-4",
      "z-30",
      "size-12",
      "rounded-full",
      "bg-primary",
      "text-primary-foreground",
      "print:hidden",
    ])
      expect(html).toContain(cls)
    expect(html).not.toMatch(/shadow-(?!none)/)
    expect(html).not.toMatch(/\b(ml|mr|pl|pr|left|right)-/)
  })

  it("aria-busy while the import runs", () => {
    expect(renderToStaticMarkup(<AccessibilityButtonView busy />)).toContain(
      'aria-busy="true"'
    )
  })
})

describe("syncWidgetWithPath", () => {
  it("loads after mount when this device saved settings", () => {
    const d = deps({ saved: vi.fn(() => true) })
    syncWidgetWithPath("/", d)
    expect(d.load).toHaveBeenCalledTimes(1)
  })

  it("does not load on a first visit", () => {
    const d = deps()
    syncWidgetWithPath("/", d)
    expect(d.load).not.toHaveBeenCalled()
    expect(d.reload).not.toHaveBeenCalled()
  })

  it("never loads in /admin, even with saved settings", () => {
    const d = deps({ saved: vi.fn(() => true) })
    syncWidgetWithPath("/admin/sessions", d)
    expect(d.load).not.toHaveBeenCalled()
    expect(d.reload).not.toHaveBeenCalled()
  })

  it("reloads on a client navigation into /admin after it loaded", () => {
    const d = deps({ requested: vi.fn(() => true) })
    syncWidgetWithPath("/admin", d)
    expect(d.reload).toHaveBeenCalledTimes(1)
    expect(d.load).not.toHaveBeenCalled()
  })

  it("a failed preload is swallowed", async () => {
    const d = deps({
      saved: vi.fn(() => true),
      load: vi.fn(() => Promise.reject(new Error("offline"))),
    })
    expect(() => syncWidgetWithPath("/", d)).not.toThrow()
  })
})

describe("openWidget", () => {
  beforeEach(() => importLibrary.mockClear())

  it("loads on click, focuses the button, then opens the panel", async () => {
    const order: string[] = []
    const open = vi.fn(() => {
      order.push("open")
      return true
    })
    const button = {
      focus: vi.fn(() => order.push("focus")),
    } as unknown as HTMLButtonElement
    const d = deps({
      load: vi.fn(async () => ({ open, close() {}, toggle() {} })),
    })
    await expect(openWidget(button, d)).resolves.toBe(true)
    expect(d.load).toHaveBeenCalledTimes(1)
    expect(order).toEqual(["focus", "open"])
  })

  it("a failed import opens nothing and leaves the button ready", async () => {
    const d = deps({ load: vi.fn(() => Promise.reject(new Error("offline"))) })
    await expect(openWidget(null, d)).resolves.toBe(false)
  })

  it("rendering never imports the library", () => {
    path.current = "/"
    renderToStaticMarkup(<AccessibilityButton />)
    expect(importLibrary).not.toHaveBeenCalled()
  })
})
