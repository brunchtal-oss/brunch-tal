import { readdirSync, readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { join, relative, sep } from "node:path"

import { describe, expect, it } from "vitest"

import {
  adminMoreNav,
  adminNav,
  currentPublicHref,
  customerNav,
  hasPublicSessions,
  isCurrent,
  publicAccountLink,
  publicLegalNav,
  publicNav,
  visibleLegalNav,
} from "./nav"

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
    [
      ...customerNav,
      ...adminNav,
      ...adminMoreNav,
      ...publicNav,
      ...publicLegalNav,
    ].map((item) => [item.href])
  )("%s has a page.tsx", (href) => {
    expect(existing.has(href)).toBe(true)
  })

  it("knows whether /sessions is in the public navigation", () => {
    expect(hasPublicSessions([{ href: "/" }])).toBe(false)
    expect(hasPublicSessions([{ href: "/" }, { href: "/sessions" }])).toBe(true)
  })

  it("lists the public pages in the menu's order, /sessions after home", () => {
    expect(publicNav.map((item) => item.href)).toEqual([
      "/",
      "/sessions",
      "/how-it-works",
      "/gallery",
      "/contact",
    ])
    expect(hasPublicSessions()).toBe(true)
  })

  it("marks the current public page", () => {
    expect(currentPublicHref("/")).toBe("/")
    expect(currentPublicHref("/gallery")).toBe("/gallery")
    expect(currentPublicHref("/contact/")).toBe("/contact")
    expect(currentPublicHref("/gallerys")).toBeNull()
    expect(currentPublicHref("/login")).toBeNull()
    expect(currentPublicHref("/sessions")).toBe("/sessions")
    expect(currentPublicHref("/sessions/1")).toBe("/sessions")
    expect(
      currentPublicHref("/sessions/1", [{ href: "/" }, { href: "/sessions" }])
    ).toBe("/sessions")
  })

  it("ends the customer's tabs with the profile (story 2.10)", () => {
    expect(customerNav.at(-1)).toMatchObject({
      href: "/me/profile",
      icon: "profile",
    })
    const profile = customerNav.at(-1)!
    expect(isCurrent(customerNav, profile, "/me/profile")).toBe(true)
    expect(isCurrent(customerNav, customerNav[0], "/me/profile")).toBe(false)
  })

  it("keeps each shell inside its own area", () => {
    for (const item of customerNav) expect(item.href).toMatch(/^\/me(\/|$)/)
    for (const item of adminNav) expect(item.href).toMatch(/^\/admin(\/|$)/)
  })

  it("puts the work tab after the sessions and marks it current (story 4.9)", () => {
    const [home, sessions, work] = adminNav
    expect(work).toMatchObject({ href: "/admin/work", icon: "work" })
    expect(isCurrent(adminNav, work, "/admin/work")).toBe(true)
    expect(isCurrent(adminNav, home, "/admin/work")).toBe(false)
    expect(isCurrent(adminNav, sessions, "/admin/work")).toBe(false)
    expect(isCurrent(adminNav, work, "/admin/workshop")).toBe(false)
    // A session's work sheet is a work screen (user decision 2026-10-07).
    expect(isCurrent(adminNav, work, "/admin/sessions/1/work")).toBe(true)
    expect(isCurrent(adminNav, sessions, "/admin/sessions/1/work")).toBe(false)
    expect(isCurrent(adminNav, home, "/admin/sessions/1/work")).toBe(false)
    // The session's other screens stay under the sessions.
    expect(isCurrent(adminNav, sessions, "/admin/sessions/1")).toBe(true)
    expect(isCurrent(adminNav, sessions, "/admin/sessions/1/edit")).toBe(true)
    expect(isCurrent(adminNav, work, "/admin/sessions/1/workshop")).toBe(false)
  })

  it("marks the longest matching item as current", () => {
    const [home, sessions, , payments, more] = adminNav
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
    // A path no other item covers falls back to home.
    expect(isCurrent(adminNav, home, "/admin/elsewhere")).toBe(true)
    expect(isCurrent(adminNav, home, "/admin/audit")).toBe(false)
    expect(isCurrent(adminNav, sessions, "/admin/sessions")).toBe(true)
    expect(isCurrent(adminNav, sessions, "/admin/sessions/new")).toBe(true)
    expect(isCurrent(adminNav, home, "/admin/sessions/new")).toBe(false)
    expect(isCurrent(adminNav, home, "/administration")).toBe(false)
    // A row of "more" keeps "more" current.
    expect(isCurrent(adminNav, more, "/admin/links")).toBe(true)
    expect(isCurrent(adminNav, home, "/admin/links")).toBe(false)
    expect(isCurrent(adminNav, more, "/admin/content/home/preview")).toBe(true)
    expect(isCurrent(adminNav, home, "/admin/content")).toBe(false)
    // Settings (story 4.7) and its templates stay last (user decision
    // 2026-10-10); the concepts (story 4.8) just before them.
    expect(adminMoreNav.at(-1)?.href).toBe("/admin/settings")
    expect(adminMoreNav.at(-2)).toMatchObject({
      href: "/admin/concepts",
      label: "קונספטים",
      icon: "concepts",
    })
    expect(isCurrent(adminNav, more, "/admin/concepts/new")).toBe(true)
    expect(
      isCurrent(adminNav, more, "/admin/settings/templates/reminder")
    ).toBe(true)
    expect(isCurrent(adminNav, home, "/admin/settings")).toBe(false)
    // The audit log (story 4.5), just before the concepts.
    expect(adminMoreNav.at(-3)?.href).toBe("/admin/audit")
    expect(isCurrent(adminNav, more, "/admin/audit")).toBe(true)
  })

  it("puts the customers first in more and keeps more current on a card (story 4.2)", () => {
    const [home, , , , more] = adminNav
    expect(adminNav).toHaveLength(5)
    expect(adminMoreNav[0]).toMatchObject({
      href: "/admin/customers",
      icon: "customers",
    })
    expect(isCurrent(adminNav, more, "/admin/customers")).toBe(true)
    expect(isCurrent(adminNav, more, "/admin/customers/1")).toBe(true)
    expect(isCurrent(adminNav, home, "/admin/customers/1")).toBe(false)
  })

  it("user decision 2026-10-08: an icon on every row of more, no accessibility row, sessions tab 'בראנצ׳ים'", () => {
    expect(adminMoreNav.map((row) => row.icon)).toEqual([
      "customers",
      "links",
      "products",
      "content",
      "notes",
      "audit",
      "concepts",
      "settings",
    ])
    expect(adminMoreNav.some((row) => row.href === "/accessibility")).toBe(
      false
    )
    expect(adminNav[1]).toMatchObject({
      href: "/admin/sessions",
      label: "בראנצ׳ים",
    })
  })

  it("shows the accessibility statement always, privacy and terms once published (story 5.5)", () => {
    const hrefs = (items: { href: string }[]) => items.map((i) => i.href)
    expect(hrefs(visibleLegalNav([]))).toEqual(["/accessibility"])
    expect(hrefs(visibleLegalNav(["privacy"]))).toEqual([
      "/privacy",
      "/accessibility",
    ])
    expect(
      hrefs(visibleLegalNav(["privacy", "terms", "accessibility"]))
    ).toEqual(["/terms", "/privacy", "/accessibility"])
    expect(
      hrefs(visibleLegalNav(["privacy", "terms"], ["privacy", "accessibility"]))
    ).toEqual(["/privacy", "/accessibility"])
  })
})

// Story 5.7: notifications open from the bell, and sign-out lives only in
// the top-bar (plus the login and join screens' own notices).
describe("the app shells after 5.7", () => {
  const ROOT = fileURLToPath(new URL("../", import.meta.url))

  function sources(dir: string): string[] {
    const found: string[] = []
    for (const entry of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) found.push(...sources(path))
      else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name))
        found.push(path.split(sep).join("/"))
    }
    return found
  }

  it("has no notifications tab", () => {
    expect(customerNav.map((item) => item.href)).not.toContain(
      "/me/notifications"
    )
    expect(adminNav.map((item) => item.href)).not.toContain(
      "/admin/notifications"
    )
  })

  it("signs out only from the top-bar, /login and /join", () => {
    const allowed = [
      /^components\/shared\/sign-out-button\.tsx$/,
      /^components\/shared\/app-top-bar\.tsx$/,
      /^app\/\(auth\)\/login\//,
      /^app\/\(auth\)\/join\//,
    ]
    const users = [...sources("app"), ...sources("components")].filter((path) =>
      /\b(SignOutButton|signOutAction)\b/.test(
        readFileSync(join(ROOT, path), "utf8")
      )
    )
    expect(users.length).toBeGreaterThan(0)
    for (const path of users) {
      expect(
        allowed.some((pattern) => pattern.test(path)),
        path
      ).toBe(true)
    }
  })

  it("links the public account by role", () => {
    expect(publicAccountLink(null).href).toBe("/login")
    expect(publicAccountLink("none").href).toBe("/login")
    expect(publicAccountLink("customer").href).toBe("/me")
    expect(publicAccountLink("admin").href).toBe("/admin")
  })
})
