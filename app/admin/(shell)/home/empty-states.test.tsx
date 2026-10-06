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
  it("five sessions: the next one with its details button, then exactly three later rows and one link to all", async () => {
    withSessions(5)
    const html = renderToStaticMarkup(await NextSessions())
    expect(loadEventDetails).toHaveBeenCalledWith(ids[0])
    // "לפרטי המפגש" is the only link to the next session; its title is
    // plain text (after the phone check, 2026-10-06).
    expect(html).toMatch(
      new RegExp(
        `href="/admin/sessions/${ids[0]}"[^>]*>${copy.sessionDetails}</a>`
      )
    )
    expect(html).not.toContain("/day")
    expect(html).not.toContain(adminCopy.sessions.morningView)
    const rows = html.match(/<li[^>]*>/g) ?? []
    // The summary-card's four figures are list items too.
    const later = [...html.matchAll(/href="\/admin\/sessions\/([^"/]+)"/g)]
      .map((m) => m[1])
      .filter((id) => id !== ids[0])
    expect(later).toEqual([ids[1], ids[2], ids[3]])
    expect(rows.length).toBe(4 + 3)
    expect(count(html, `href="/admin/sessions/${ids[0]}"`)).toBe(1)
    expect(count(html, copy.allSessions)).toBe(1)
  })

  it("one session: no later rows and one link to all", async () => {
    withSessions(1)
    const html = renderToStaticMarkup(await NextSessions())
    expect(html).not.toContain(copy.upcoming)
    expect(count(html, copy.allSessions)).toBe(1)
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
      /<span aria-hidden="true"[^>]*bg-primary[^>]*>2<\/span>/
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
      /<span aria-hidden="true"[^>]*bg-primary[^>]*>5<\/span>/
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
