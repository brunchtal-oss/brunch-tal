import { renderToStaticMarkup } from "react-dom/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { shellCopy } from "@/lib/copy/shell"

import { HOME_SESSIONS, UpcomingSessions } from "./upcoming-sessions"

const list = vi.fn()

vi.mock("next/server", () => ({ connection: async () => {} }))
vi.mock("@/lib/sessions/public", () => ({
  listUpcomingPublicSessions: (...args: unknown[]) => list(...args),
}))

beforeEach(() => {
  list.mockReset()
})

// The home page's area (story 5.16): up to HOME_SESSIONS sessions, and no
// area at all when the read fails.
describe("UpcomingSessions", () => {
  it("reads up to three sessions and shows them", async () => {
    list.mockResolvedValue([
      {
        id: "00000000-0000-4000-8000-000000000001",
        starts_at: "2026-12-11T08:00:00+00:00",
        description: null,
        display_price_agorot: null,
        concept_name: "concept-1",
      },
    ])
    const html = renderToStaticMarkup(await UpcomingSessions())
    expect(list).toHaveBeenCalledWith(HOME_SESSIONS)
    expect(html).toContain(shellCopy.public.sessions.upcoming)
    expect(html).toContain("concept-1")
    // The weekday and date, never the time (design round 2026-10-08).
    expect(html).toContain("11.12")
    expect(html.replace(/<[^>]*>/g, " ")).not.toMatch(/\d{2}:\d{2}/)
  })

  it("leaves the area out and logs when the read fails", async () => {
    list.mockRejectedValue(new Error("down"))
    const error = vi.spyOn(console, "error").mockImplementation(() => {})
    expect(await UpcomingSessions()).toBeNull()
    expect(error).toHaveBeenCalledWith("sessions.home_read_failed")
  })
})
