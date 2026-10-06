import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"

import { shellCopy } from "@/lib/copy/shell"
import type { NotificationView } from "@/lib/notifications/shared"

import { AppTopBar } from "./app-top-bar"
import { BellButton } from "./bell-button"
import { NotificationItem } from "./notification-item"
import { NotificationList } from "./notification-list"

vi.mock("next/navigation", () => ({
  usePathname: () => "/me",
  useRouter: () => ({ push: vi.fn() }),
}))
vi.mock("@/lib/auth/sign-out", () => ({ signOutAction: vi.fn() }))

const copy = shellCopy.notifications
const NOW = new Date("2026-10-06T09:00:00Z")

function item(over: Partial<NotificationView> = {}): NotificationView {
  return {
    id: "n1",
    title: "title-1",
    body: "body-1",
    targetPath: "/me/bookings",
    createdAt: "2026-10-06T05:15:00Z",
    read: false,
    ...over,
  }
}

describe("AppTopBar", () => {
  const html = renderToStaticMarkup(
    <AppTopBar home="/me" bell={<span>bell-slot</span>} />
  )

  it("is the sticky olive bar with the name home, the bell and sign-out", () => {
    expect(html).toMatch(/^<header[^>]*data-top-bar/)
    expect(html).toContain("sticky top-0")
    expect(html).toContain("bg-primary text-primary-foreground")
    expect(html).toContain('href="/me"')
    expect(html).toContain(shellCopy.wordmark)
    expect(html).toContain("bell-slot")
    expect(html).toMatch(
      new RegExp(`<button type="submit" aria-label="${shellCopy.signOut}"`)
    )
    expect(html).toContain("size-11")
  })

  it("keeps the order name, bell, sign-out", () => {
    const name = html.indexOf(shellCopy.wordmark)
    const bell = html.indexOf("bell-slot")
    const signOut = html.indexOf(shellCopy.signOut)
    expect(name).toBeLessThan(bell)
    expect(bell).toBeLessThan(signOut)
  })

  it("links the admin bar to /admin", () => {
    const admin = renderToStaticMarkup(
      <AppTopBar home="/admin" wide bell={null} />
    )
    expect(admin).toContain('href="/admin"')
    expect(admin).toContain("lg:max-w-none")
  })

  it("has the site link before the bell in the admin bar only", () => {
    const admin = renderToStaticMarkup(
      <AppTopBar home="/admin" wide bell={<span>bell-slot</span>} />
    )
    const link = admin.match(/<a[^>]*aria-label="([^"]*)"[^>]*>/)
    expect(link?.[1]).toBe(shellCopy.toSite)
    expect(link?.[0]).toContain('href="/"')
    expect(link?.[0]).not.toContain("target=")
    expect(link?.[0]).toContain("size-11")
    expect(admin.indexOf(shellCopy.toSite)).toBeLessThan(
      admin.indexOf("bell-slot")
    )
    expect(html).not.toContain(shellCopy.toSite)
    expect(html).not.toContain('href="/"')
  })

  it("has no physical direction classes", () => {
    expect(html).not.toMatch(/\b(ml|mr|pl|pr|left|right)-/)
  })
})

describe("BellButton", () => {
  it("names the unread count and shows it as a pill", () => {
    const html = renderToStaticMarkup(
      <BellButton href="/me/notifications" initialCount={3} />
    )
    expect(html).toContain('href="/me/notifications"')
    expect(html).toContain(`aria-label="${copy.bellUnread("3")}"`)
    expect(html).toMatch(/data-unread-count=""[^>]*>3<\/span>/)
    expect(html).toContain('aria-live="polite"')
  })

  it("shows 99+ above 99", () => {
    const html = renderToStaticMarkup(
      <BellButton href="/admin/notifications" initialCount={150} />
    )
    expect(html).toContain(`aria-label="${copy.bellUnread("99+")}"`)
    expect(html).toMatch(/>99\+<\/span>/)
  })

  it("has no pill without unread (and while the count streams in)", () => {
    for (const count of [0, null]) {
      const html = renderToStaticMarkup(
        <BellButton href="/me/notifications" initialCount={count} />
      )
      expect(html).toContain(`aria-label="${copy.bell}"`)
      expect(html).not.toContain("data-unread-count")
    }
  })
})

describe("NotificationItem", () => {
  it("an unread row: one link, sr-only word, decorative dot, toggle outside", () => {
    const html = renderToStaticMarkup(
      <NotificationItem item={item()} href="/me/bookings" now={NOW} />
    )
    expect(html).toMatch(
      new RegExp(
        `<a [^>]*href="/me/bookings"[^>]*>.*<span class="sr-only">${copy.unread}, </span>title-1.*</a><button`
      )
    )
    expect(html.match(/<a /g)).toHaveLength(1)
    expect(html).toMatch(/<span aria-hidden="true" class="[^"]*bg-brand-accent/)
    expect(html).toContain("font-semibold")
    expect(html).toContain("body-1")
    expect(html).toContain(copy.time.today("08:15"))
    expect(html).toContain(`aria-label="${copy.markRead}"`)
    // Nothing interactive inside the link.
    const link = html.slice(html.indexOf("<a "), html.indexOf("</a>"))
    expect(link).not.toContain("<button")
  })

  it("a read row: plain title, no dot, mark as unread", () => {
    const html = renderToStaticMarkup(
      <NotificationItem
        item={item({ read: true })}
        href="/me/bookings"
        now={NOW}
      />
    )
    expect(html).not.toContain(copy.unread + ",")
    expect(html).not.toContain("bg-brand-accent")
    expect(html).toContain(`aria-label="${copy.markUnread}"`)
  })
})

describe("NotificationList", () => {
  const actions = {
    markRead: vi.fn(async () => ({ ok: true as const, data: { marked: 1 } })),
    markUnread: vi.fn(async () => ({ ok: true as const, data: { marked: 1 } })),
  }

  it("is one sentence without an action when empty", () => {
    const html = renderToStaticMarkup(
      <NotificationList surface="customer" initialItems={[]} {...actions} />
    )
    expect(html).toBe(
      `<p class="text-base text-muted-foreground">${copy.empty}</p>`
    )
  })

  it("offers mark all only while something is unread", () => {
    const unread = renderToStaticMarkup(
      <NotificationList
        surface="customer"
        initialItems={[item(), item({ id: "n2", read: true })]}
        {...actions}
      />
    )
    expect(unread).toContain(copy.markAllRead)
    expect(unread.match(/data-notification-item/g)).toHaveLength(2)

    const allRead = renderToStaticMarkup(
      <NotificationList
        surface="customer"
        initialItems={[item({ read: true })]}
        {...actions}
      />
    )
    expect(allRead).not.toContain(copy.markAllRead)
  })

  it("links only inside the surface", () => {
    const html = renderToStaticMarkup(
      <NotificationList
        surface="customer"
        initialItems={[item({ targetPath: "/admin/links" })]}
        {...actions}
      />
    )
    expect(html).toContain('href="/me"')
    expect(html).not.toContain("/admin/links")
  })
})
