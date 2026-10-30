import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

import { describe, expect, it } from "vitest"

// DESIGN.md › Colors, Shapes, Elevation and the focus ring, as written in
// app/globals.css.
const css = readFileSync(
  fileURLToPath(new URL("./globals.css", import.meta.url)),
  "utf8"
).replace(/\r\n/g, "\n") // a Windows checkout may have CRLF

function block(selector: string) {
  const start = css.indexOf(`${selector} {`)
  expect(start, `no ${selector} block`).toBeGreaterThanOrEqual(0)
  return css.slice(start, css.indexOf("\n}", start))
}

function value(source: string, name: string) {
  const match = source.match(new RegExp(`${name}:\\s*([^;]+);`))
  return match?.[1].trim()
}

describe("globals.css", () => {
  const root = block(":root")
  const theme = block("@theme inline")

  it.each([
    ["--background", "#FAF6EE"],
    ["--foreground", "#2E2A1F"],
    ["--card", "#FFFDF8"],
    ["--primary", "#4A4A2A"],
    ["--primary-foreground", "#FAF6EE"],
    ["--muted", "#F2ECDF"],
    ["--muted-foreground", "#6B6450"],
    ["--accent", "#F2ECDF"],
    ["--brand-accent", "#8A875A"],
    ["--destructive", "#B42318"],
    ["--border", "#E6DFCF"],
    ["--input", "#6B6450"],
    ["--ring", "#4A4A2A"],
    ["--sidebar", "#FFFDF8"],
    ["--radius", "0.5rem"],
  ])(":root sets %s to %s", (name, expected) => {
    expect(value(root, name)?.toLowerCase()).toBe(expected.toLowerCase())
  })

  it.each([
    ["--color-success", "#4E6B34"],
    ["--color-success-tint", "#E7EDDC"],
    ["--color-warning", "#8C5E14"],
    ["--color-error", "#B42318"],
    ["--color-pending", "#4A5A6A"],
    ["--color-expired", "#676154"],
    ["--color-expired-dot", "#B0A998"],
    ["--radius-lg", "calc(var(--radius) * 0.5)"],
    ["--radius-xl", "var(--radius)"],
    ["--radius-2xl", "calc(var(--radius) * 1.5)"],
    ["--shadow-sm", "0 0 #0000"],
    ["--shadow-lg", "0 0 #0000"],
  ])("@theme inline sets %s", (name, expected) => {
    expect(value(theme, name)?.toLowerCase()).toBe(expected.toLowerCase())
  })

  it("has no dark mode", () => {
    // The `@custom-variant dark` line stays (inert): no .dark block sets
    // colours and no rule targets a .dark class.
    expect(css).not.toMatch(/(^|\n)\s*\.dark\s*\{/)
    expect(css).not.toMatch(/\.dark[^\n{]*\{[^}]*--/)
  })

  it("never removes the outline", () => {
    expect(css).not.toMatch(/outline:\s*none/)
    expect(css).not.toMatch(/outline-none/)
  })

  it("draws a two-tone focus ring on :focus-visible", () => {
    const focus = block(":focus-visible")
    expect(value(focus, "outline")).toBe("2px solid var(--ring)")
    expect(value(focus, "outline-offset")).toBe("2px")
  })

  it("keeps the --input border of a valid field on focus, not of an invalid one", () => {
    const selectors = ["input", "textarea", "native-select", "select-trigger"]
      .map(
        (slot) =>
          `[data-slot="${slot}"]:focus-visible:not([aria-invalid="true"])`
      )
      .join(",\n")
    const field = block(selectors)
    expect(value(field, "border-color")).toBe("var(--input)")
    // Unlayered, so it wins over shadcn's focus-visible:border-ring.
    const layer = css.indexOf("@layer base {")
    expect(css.indexOf(field)).toBeGreaterThan(css.indexOf("\n}\n", layer))
  })

  // Story 5.25: the accessibility button above the bars and the notice, and
  // the room the page keeps for it.
  describe("accessibility button", () => {
    const flat = css.replace(/\s+/g, " ")

    function rule(selector: string) {
      const start = flat.indexOf(`${selector} {`)
      expect(start, `no ${selector} rule`).toBeGreaterThanOrEqual(0)
      return flat.slice(start, flat.indexOf("}", start))
    }

    it("keeps --a11y-room while the button is in the page", () => {
      const root = rule("html:has([data-a11y-button])")
      expect(root).toContain("--a11y-room: 4rem")
      expect(root).toContain("scroll-padding-bottom: var(--a11y-room)")
    })

    it("sits 16 above the bottom, the whatsapp-bar and the tab bar", () => {
      expect(rule("[data-a11y-button]")).toContain(
        "bottom: calc(1rem + env(safe-area-inset-bottom))"
      )
      expect(
        rule("body:has([data-whatsapp-bar]) [data-a11y-button]")
      ).toContain(
        "bottom: calc(4.5rem + 1px + env(safe-area-inset-bottom) + 1rem)"
      )
      expect(rule("body:has([data-tab-bar]) [data-a11y-button]")).toContain(
        "bottom: calc( var(--tab-bar-height, calc(4.25rem + 1px + env(safe-area-inset-bottom))) + 1rem )"
      )
    })

    it("sits 8 above the open cookie notice", () => {
      for (const selector of [
        "body:has([data-cookie-notice]) [data-a11y-button]",
        "body:has([data-whatsapp-bar]):has([data-cookie-notice]) [data-a11y-button]",
      ])
        expect(rule(selector)).toMatch(
          /var\(--cookie-notice-height, 0px\) \+ 0\.5rem/
        )
    })

    it("adds the room under the tab bar, the footer and a bare page", () => {
      for (const selector of [
        "html:has([data-tab-bar])",
        "body:has([data-tab-bar])",
        "html:has([data-whatsapp-bar])",
        "body:has([data-whatsapp-bar]) [data-site-footer]",
      ])
        expect(rule(selector)).toContain("var(--a11y-room, 0px)")
      expect(rule("body:has([data-a11y-button]) [data-site-footer]")).toContain(
        "padding-bottom: var(--a11y-room)"
      )
      expect(
        rule(
          "body:has([data-a11y-button]):not(:has([data-tab-bar])):not( :has([data-site-footer]) ) #main"
        )
      ).toContain("padding-bottom: var(--a11y-room)")
    })
  })
})

// Story 6.7, T23 (SC10, SN7): every text colour reaches WCAG AA (4.5:1) on
// the surfaces it is drawn on. The values are read from globals.css itself.
// brand-accent is not a text colour (graphics only, 3:1); its use on screen
// is checked in the browser (MA3).
describe("text contrast of the palette", () => {
  const root = block(":root")
  const theme = block("@theme inline")

  function hex(name: string): string {
    const raw = value(root, name) ?? value(theme, name)
    expect(raw, `${name} is not set`).toMatch(/^#[0-9a-f]{6}$/i)
    return raw!
  }

  // WCAG 2.x relative luminance and contrast ratio.
  function luminance(color: string): number {
    const [r, g, b] = [1, 3, 5].map((i) => {
      const c = parseInt(color.slice(i, i + 2), 16) / 255
      return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
    })
    return 0.2126 * r + 0.7152 * g + 0.0722 * b
  }
  function ratio(a: string, b: string): number {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
    return (hi + 0.05) / (lo + 0.05)
  }

  const TEXT = [
    "--foreground",
    "--card-foreground",
    "--muted-foreground",
    "--primary",
    "--destructive",
    "--color-success",
    "--color-warning",
    "--color-error",
    "--color-pending",
    "--color-expired",
  ]
  // The page, the card and the filled surfaces text sits on (bg-muted,
  // bg-secondary, bg-accent hover, a popover). There is no
  // --destructive-foreground token, so no pair for it.
  const SURFACES = [
    "--background",
    "--card",
    "--muted",
    "--secondary",
    "--accent",
    "--popover",
  ]
  const STATUS = ["success", "warning", "error", "pending", "expired"]
  const pairs: Array<[string, string]> = [
    ...TEXT.flatMap((text) =>
      SURFACES.map((surface): [string, string] => [text, surface])
    ),
    ["--primary-foreground", "--primary"],
    ["--popover-foreground", "--popover"],
    ["--secondary-foreground", "--secondary"],
    ["--accent-foreground", "--accent"],
    // A status chip: the status colour on its own tint.
    ...STATUS.map((s): [string, string] => [
      `--color-${s}`,
      `--color-${s}-tint`,
    ]),
  ]

  it.each(pairs)("%s on %s is at least 4.5:1", (text, surface) => {
    const r = ratio(hex(text), hex(surface))
    expect(
      r,
      `${text} on ${surface}: ${r.toFixed(2)}:1`
    ).toBeGreaterThanOrEqual(4.5)
  })

  it("the ratio is computed correctly (ink on white 21:1, a grey on white about 4.5:1)", () => {
    expect(ratio("#000000", "#ffffff")).toBeCloseTo(21, 5)
    expect(ratio("#767676", "#ffffff")).toBeCloseTo(4.54, 2)
  })
})
