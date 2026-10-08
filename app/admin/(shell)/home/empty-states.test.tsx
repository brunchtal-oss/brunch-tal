import { renderToStaticMarkup } from "react-dom/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { adminCopy } from "@/lib/copy/admin"

import type { AttentionRow, HomeData } from "../home-items"

const loadHome = vi.fn<() => Promise<HomeData>>()
const loadAttentionItems = vi.fn<() => Promise<AttentionRow[]>>()
const loadEventDetails = vi.fn()
const detailsSummary = vi.fn()

vi.mock("./load-home", () => ({
  loadHome: () => loadHome(),
  loadAttentionItems: () => loadAttentionItems(),
}))
vi.mock("../sessions/[id]/load-details", () => ({
  loadEventDetails: (id: string) => loadEventDetails(id),
  detailsSummary: (details: unknown) => detailsSummary(details),
}))

const { AllAttentionItems, AttentionList } = await import("./attention-list")
const { NextSessions } = await import("./next-sessions")

const copy = adminCopy.home

const EMPTY_HOME: HomeData = {
  upcoming_sessions: [],
  expiring_cards: [],
  totals: {
    period_start: "2026-10-01",
    period_end: "2026-10-06",
    approved_count: 0,
    approved_agorot: 0,
    net_agorot: 0,
  },
}

beforeEach(() => {
  loadHome.mockReset()
  loadAttentionItems.mockReset()
  loadEventDetails.mockReset()
  detailsSummary.mockReset()
})

// The two empty rows of the spec's matrix ("אין מפגש", "ריק").
describe("home empty states", () => {
  it("no upcoming session: the empty line and a link to the sessions", async () => {
    loadHome.mockResolvedValue(EMPTY_HOME)
    const html = renderToStaticMarkup(await NextSessions())
    expect(html).toContain(copy.noSessions)
    expect(html).toContain(copy.toSessions)
    expect(html).toContain('href="/admin/sessions"')
    expect(loadEventDetails).not.toHaveBeenCalled()
  })

  it("no items to handle: the empty line and no counter", async () => {
    loadAttentionItems.mockResolvedValue([])
    const html = renderToStaticMarkup(await AttentionList())
    expect(html).toContain(copy.attentionEmpty)
    expect(html).not.toContain(copy.attentionCount(0))
    expect(html).not.toContain("<li")
  })
})

const ids = [1, 2, 3, 4, 5].map(
  (n) => `00000000-0000-4000-8000-00000000000${n}`
)

function session(n: number) {
  return {
    event_id: ids[n],
    concept_name: `קונספט ${n}`,
    kind: "regular",
    starts_at: `2026-10-1${n}T07:00:00Z`,
    ends_at: `2026-10-1${n}T11:00:00Z`,
    occupied: n,
    capacity: 12,
  }
}

function withSessions(count: number) {
  loadHome.mockResolvedValue({
    ...EMPTY_HOME,
    upcoming_sessions: Array.from({ length: count }, (_, n) => session(n)),
  })
  loadEventDetails.mockResolvedValue({
    id: ids[0],
    conceptName: "קונספט 0",
    kind: "regular",
    status: "published",
    startsAt: "2026-10-10T07:00:00Z",
    endsAt: "2026-10-10T11:00:00Z",
    capacity: 12,
    occupied: 0,
    attendees: [],
  })
  detailsSummary.mockReturnValue({
    occupied: 0,
    capacity: 12,
    bookings: 0,
    babies: 0,
    allergies: 0,
  })
}

function count(html: string, text: string): number {
  return html.split(text).length - 1
}

describe("home sections with data", () => {
  it("five sessions: a tile for the next and one for the one after it, then one link to all", async () => {
    withSessions(5)
    const html = renderToStaticMarkup(await NextSessions())
    expect(loadEventDetails).toHaveBeenCalledWith(ids[0])
    // Two tiles, each with "לפרטי המפגש" as its only link (design round,
    // user decision 2026-10-08: no "לדף העבודה"); no rows after the second.
    expect(count(html, "<section")).toBe(2)
    expect(html).toMatch(
      new RegExp(
        `href="/admin/sessions/${ids[0]}"[^>]*>${copy.sessionDetails}</a>`
      )
    )
    expect(html).toMatch(
      new RegExp(
        `href="/admin/sessions/${ids[1]}"[^>]*>${copy.sessionDetails}</a>`
      )
    )
    expect(html).not.toContain("/work")
    expect(html).not.toContain("/day")
    expect(html).not.toContain(adminCopy.sessions.morningView)
    const linked = [
      ...html.matchAll(/href="\/admin\/sessions\/([^"/]+)"/g),
    ].map((m) => m[1])
    expect(linked).toEqual([ids[0], ids[1]])
    expect(count(html, copy.allSessions)).toBe(1)
    // The next tile: places, babies and allergies; no "נרשמות".
    expect(html).toContain(copy.nextSession)
    expect(html).toContain(adminCopy.sessions.summary.places)
    expect(html).toContain(adminCopy.sessions.summary.babies)
    expect(html).toContain(adminCopy.sessions.summary.allergies)
    expect(html).not.toContain(adminCopy.sessions.summary.bookings)
    // The second tile's places, at inline-end of its date.
    expect(html).toContain("1/12")
    // The weekday and date, never the time (2026-10-08).
    expect(html.replace(/<[^>]*>/g, " ")).not.toMatch(/\d{2}:\d{2}/)
  })

  it("one session: one tile and one link to all", async () => {
    withSessions(1)
    const html = renderToStaticMarkup(await NextSessions())
    expect(count(html, "<section")).toBe(1)
    expect(count(html, copy.allSessions)).toBe(1)
    expect(html.indexOf(copy.sessionDetails)).toBeLessThan(
      html.indexOf(copy.allSessions)
    )
  })
})

function attentionRows(n: number): AttentionRow[] {
  return Array.from({ length: n }, (_, i) => ({
    kind: "media_stuck" as const,
    id: `m${i}`,
    customer_label: null,
    since: `2026-10-1${9 - i}T07:00:00Z`,
  }))
}

describe("לטיפול", () => {
  it("two items: the counter, the count line and both rows, no link to all", async () => {
    loadAttentionItems.mockResolvedValue(attentionRows(2))
    const html = renderToStaticMarkup(await AttentionList())
    expect(html).toContain(copy.attentionCount(2))
    expect(html).toMatch(
      /<span aria-hidden="true"[^>]*bg-saffron[^>]*>2<\/span>/
    )
    expect(count(html, "<li")).toBe(2)
    expect(html).not.toContain('href="/admin/attention"')
  })

  it("three items: all three, no link to all", async () => {
    loadAttentionItems.mockResolvedValue(attentionRows(3))
    const html = renderToStaticMarkup(await AttentionList())
    expect(count(html, "<li")).toBe(3)
    expect(html).not.toContain('href="/admin/attention"')
  })

  it("five items on the home: the three newest, a counter of 5 and the link to all", async () => {
    loadAttentionItems.mockResolvedValue(attentionRows(5))
    const html = renderToStaticMarkup(await AttentionList())
    expect(count(html, "<li")).toBe(3)
    expect(html).toContain(copy.attentionCount(5))
    expect(html).toMatch(
      /<span aria-hidden="true"[^>]*bg-saffron[^>]*>5<\/span>/
    )
    expect(html).toContain('href="/admin/attention"')
    expect(html).toContain(copy.attentionAll(5))
  })

  it("/admin/attention: all five items", async () => {
    loadAttentionItems.mockResolvedValue(attentionRows(5))
    const html = renderToStaticMarkup(await AllAttentionItems())
    expect(count(html, "<li")).toBe(5)
    expect(html).toContain(copy.attentionCount(5))
    expect(html).not.toContain('href="/admin/attention"')
  })

  it("/admin/attention with nothing: the empty line", async () => {
    loadAttentionItems.mockResolvedValue([])
    const html = renderToStaticMarkup(await AllAttentionItems())
    expect(html).toContain(copy.attentionEmpty)
  })
})
