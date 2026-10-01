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
})
