import { readdirSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { join, relative, sep } from "node:path"

import { describe, expect, it } from "vitest"

import { adminMoreNav, adminNav, customerNav, isCurrent } from "./nav"

const APP = fileURLToPath(new URL("../app/", import.meta.url))

// URL paths of every app/**/page.tsx (route groups "(x)" removed).
function routes(): Set<string> {
  const found = new Set<string>()
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) walk(path)
      else if (entry.name === "page.tsx") {
        const segments = relative(APP, dir)
          .split(sep)
          .filter((s) => s && !/^\(.*\)$/.test(s))
        found.add(`/${segments.join("/")}`)
      }
    }
  }
  walk(APP)
  return found
}

describe("navigation", () => {
  const existing = routes()

  it.each(
    [...customerNav, ...adminNav, ...adminMoreNav].map((item) => [item.href])
  )("%s has a page.tsx", (href) => {
    expect(existing.has(href)).toBe(true)
  })

  it("keeps each shell inside its own area", () => {
    for (const item of customerNav) expect(item.href).toMatch(/^\/me(\/|$)/)
    for (const item of adminNav) expect(item.href).toMatch(/^\/admin(\/|$)/)
  })

  it("marks the longest matching item as current", () => {
    const [home, payments, more] = adminNav
    expect(isCurrent(adminNav, home, "/admin")).toBe(true)
    expect(isCurrent(adminNav, more, "/admin")).toBe(false)
    expect(isCurrent(adminNav, more, "/admin/more")).toBe(true)
    expect(isCurrent(adminNav, home, "/admin/more")).toBe(false)
    expect(isCurrent(adminNav, payments, "/admin/payments")).toBe(true)
    expect(isCurrent(adminNav, payments, "/admin/payments/new")).toBe(true)
    expect(
      isCurrent(adminNav, payments, "/admin/payments/new/existing/x")
    ).toBe(true)
    expect(isCurrent(adminNav, home, "/admin/payments/new")).toBe(false)
    expect(isCurrent(adminNav, home, "/admin/sessions")).toBe(true)
    expect(isCurrent(adminNav, home, "/administration")).toBe(false)
    // A row of "more" keeps "more" current.
    expect(isCurrent(adminNav, more, "/admin/links")).toBe(true)
    expect(isCurrent(adminNav, home, "/admin/links")).toBe(false)
  })
})
