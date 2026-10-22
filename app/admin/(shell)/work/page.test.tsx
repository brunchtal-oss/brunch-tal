import { renderToStaticMarkup } from "react-dom/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { adminCopy } from "@/lib/copy/admin"

import type { UpcomingSessionRow } from "../home-items"

const loadHome = vi.fn()

vi.mock("../home/load-home", () => ({
  loadHome: () => loadHome(),
}))

const { WorkSessions } = await import("./page")

const copy = adminCopy.work

function session(n: number): UpcomingSessionRow {
  return {
    event_id: `00000000-0000-4000-8000-00000000000${n}`,
    concept_name: `concept-${n}`,
    kind: "regular",
    starts_at: `2026-11-0${n}T07:30:00Z`,
    ends_at: `2026-11-0${n}T10:00:00Z`,
    occupied: 3,
    capacity: 12,
  }
}

function hrefs(html: string): string[] {
  return [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1])
}

beforeEach(() => {
  loadHome.mockReset()
})

// Story 4.9: the work tab lists the next three sessions, each a link to its
// work sheet, then a link to every session.
describe("the work tab", () => {
  it("at most three sessions, each to its work sheet, then all sessions", async () => {
    const sessions = [1, 2, 3, 4].map(session)
    loadHome.mockResolvedValue({ upcoming_sessions: sessions })
    const html = renderToStaticMarkup(await WorkSessions())
    expect(hrefs(html)).toEqual([
      `/admin/sessions/${sessions[0].event_id}/work`,
      `/admin/sessions/${sessions[1].event_id}/work`,
      `/admin/sessions/${sessions[2].event_id}/work`,
      "/admin/sessions",
    ])
    expect(html).toContain("concept-1")
    expect(html).not.toContain("concept-4")
    expect(html).toContain(copy.allBrunches)
    expect(html).not.toContain(copy.noSessions)
  })

  it("fewer than three: only those", async () => {
    loadHome.mockResolvedValue({ upcoming_sessions: [session(1)] })
    const html = renderToStaticMarkup(await WorkSessions())
    expect(hrefs(html)).toEqual([
      `/admin/sessions/${session(1).event_id}/work`,
      "/admin/sessions",
    ])
  })

  it("none: the empty text and a link to the sessions", async () => {
    loadHome.mockResolvedValue({ upcoming_sessions: [] })
    const html = renderToStaticMarkup(await WorkSessions())
    expect(html).toContain(copy.noSessions)
    expect(html).toContain(copy.toSessions)
    expect(hrefs(html)).toEqual(["/admin/sessions"])
  })
})
