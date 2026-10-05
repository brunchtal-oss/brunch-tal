import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"

import { customerCopy } from "@/lib/copy/customer"
import { shellCopy } from "@/lib/copy/shell"
import type { PublicSession } from "@/lib/sessions/public"

import {
  PublicSessionAction,
  PublicSessionList,
  PublicSessionView,
} from "./public-sessions"
import { HOME_SESSIONS, UpcomingSessionsSection } from "./upcoming-sessions"

// upcoming-sessions imports the reader, which imports the anon client; the
// presentational parts never call it.
vi.mock("@/lib/supabase/public", () => ({
  createPublicClient: () => {
    throw new Error("no database in unit tests")
  },
}))

const copy = shellCopy.public.sessions
const WA = "https://wa.me/972544256456?text=hi"

function session(n: number, extra: Partial<PublicSession> = {}) {
  return {
    id: `00000000-0000-4000-8000-00000000000${n}`,
    starts_at: `2026-12-1${n}T08:00:00+00:00`,
    description: null,
    display_price_agorot: null,
    concept_name: `concept-${n}`,
    photo: null,
    ...extra,
  } as PublicSession
}

// Words a guest must never see on the public session screens.
const FORBIDDEN = [
  "יש מקום",
  "מקומות אחרונים",
  "מלא",
  "רגיל",
  "זוגי",
  "לשני מבוגרים",
  customerCopy.withBabies.regular,
  customerCopy.withBabies.couple,
]

function expectNoPlacesOrKind(html: string) {
  for (const word of FORBIDDEN) expect(html).not.toContain(word)
  // No "9/12"-style number in the visible text (tags removed).
  expect(html.replace(/<[^>]*>/g, " ")).not.toMatch(/\d+\s*\/\s*\d+/)
}

describe("PublicSessionList", () => {
  it("shows a card per session linking to its public page, in order", () => {
    const html = renderToStaticMarkup(
      <PublicSessionList
        sessions={[session(1), session(2)]}
        whatsappHref={WA}
      />
    )
    expect(html.match(/<article/g)).toHaveLength(2)
    expect(html.indexOf("concept-1")).toBeLessThan(html.indexOf("concept-2"))
    expect(html).toContain(`href="/sessions/${session(1).id}"`)
    expect(html).not.toContain("/me/sessions")
    expect(html.match(/<h2[ >]/g)).toHaveLength(2)
    expect(html).not.toContain("<h3")
    expect(html).not.toContain(customerCopy.sessionsEmpty)
    expectNoPlacesOrKind(html)
  })

  it("shows the empty-state with the WhatsApp link", () => {
    const html = renderToStaticMarkup(
      <PublicSessionList sessions={[]} whatsappHref={WA} />
    )
    expect(html).toContain(customerCopy.sessionsEmpty)
    expect(html).toContain(`href="${WA}"`)
    expect(html).toContain(shellCopy.public.emptyPageWhatsapp)
    expect(html).not.toContain("<article")
  })

  it("shows the empty-state without a link when there is no number", () => {
    const html = renderToStaticMarkup(
      <PublicSessionList sessions={[]} whatsappHref={null} />
    )
    expect(html).toContain(customerCopy.sessionsEmpty)
    expect(html).not.toContain("<a")
  })
})

describe("UpcomingSessionsSection", () => {
  it("shows the sessions under its heading, then the link to all", () => {
    const html = renderToStaticMarkup(
      <UpcomingSessionsSection
        sessions={[session(1), session(2), session(3)]}
      />
    )
    expect(HOME_SESSIONS).toBe(3)
    expect(html).toContain(copy.upcoming)
    expect(html.match(/<article/g)).toHaveLength(3)
    // The cards' titles are under the section heading (the only h2).
    expect(html.match(/<h3[ >]/g)).toHaveLength(3)
    // Story 5.4: a low horizontal card with a square photo at inline-end.
    expect(html.match(/aspect-square/g)).toHaveLength(3)
    expect(html.match(/flex-row/g)).toHaveLength(3)
    expect(html.match(/<h2[ >]/g)).toHaveLength(1)
    expect(html).toMatch(new RegExp(`href="/sessions"[^>]*>${copy.all}<`))
    expect(html.indexOf(copy.upcoming)).toBeLessThan(html.indexOf(copy.all))
    expectNoPlacesOrKind(html)
  })

  it("is not there without sessions", () => {
    expect(
      renderToStaticMarkup(<UpcomingSessionsSection sessions={[]} />)
    ).toBe("")
  })
})

describe("PublicSessionView", () => {
  const view = (s: PublicSession) =>
    renderToStaticMarkup(
      <PublicSessionView session={s} action={<span>the-action</span>} />
    )

  it("shows the header, the price, the description and the action in order", () => {
    const html = view(
      session(1, { display_price_agorot: 13800, description: "the-text" })
    )
    expect(html).toMatch(/<h1[^>]*>[\s\S]*concept-1[\s\S]*<\/h1>/)
    expect(html).toContain(customerCopy.brunch)
    const price = html.indexOf("138 ₪")
    expect(price).toBeGreaterThan(html.indexOf("concept-1"))
    expect(html.indexOf("the-text")).toBeGreaterThan(price)
    expect(html.indexOf("the-action")).toBeGreaterThan(html.indexOf("the-text"))
    expectNoPlacesOrKind(html)
  })

  it("has no price line without a display price", () => {
    const html = view(session(1))
    expect(html).not.toContain("₪")
    expect(html).not.toContain("<bdi>1")
  })

  it("shows the description it is given (the session's or the concept's) and none without one", () => {
    expect(view(session(1, { description: "concept text" }))).toContain(
      "concept text"
    )
    const html = view(session(1))
    expect(html.match(/<p[ >]/g)).toHaveLength(1) // the date only
  })
})

describe("PublicSessionAction", () => {
  const id = session(1).id

  it("a guest: log in to the session in her area, or contact on WhatsApp", () => {
    const html = renderToStaticMarkup(
      <PublicSessionAction sessionId={id} customer={false} whatsappHref={WA} />
    )
    expect(html).toContain(copy.guestBefore.trim())
    expect(html).toMatch(
      new RegExp(
        `<a[^>]*href="${WA.replace(/[?]/g, "\\?")}"[^>]*>${copy.guestContact}`
      )
    )
    expect(html).toContain(`href="/login?next=/me/sessions/${id}"`)
    expect(html).toContain(`>${copy.guestLogin}</a>`)
    // "להרשמה התחברי או צרי קשר": log in first, then contact.
    expect(html.indexOf(copy.guestLogin)).toBeLessThan(
      html.indexOf(copy.guestContact)
    )
    // Both inline links get the larger touch area.
    expect(html.match(/<a [^>]*py-2\.5/g)).toHaveLength(2)
    expect(html).not.toContain(`>${customerCopy.book}<`)
    expect(html).not.toMatch(/טל/)
  })

  it("a guest without a WhatsApp number: plain text for contact", () => {
    const html = renderToStaticMarkup(
      <PublicSessionAction
        sessionId={id}
        customer={false}
        whatsappHref={null}
      />
    )
    expect(html).toContain(copy.guestContact)
    expect(html.match(/<a/g)).toHaveLength(1)
    expect(html).toContain("/login?next=")
  })

  it("a signed-in customer: book in her area", () => {
    const html = renderToStaticMarkup(
      <PublicSessionAction sessionId={id} customer whatsappHref={WA} />
    )
    expect(html).toMatch(
      new RegExp(
        `<a[^>]*href="/me/sessions/${id}"[^>]*>${customerCopy.book}</a>`
      )
    )
    expect(html).not.toContain(copy.guestLogin)
    expect(html).not.toContain(WA)
  })
})
