import { renderToStaticMarkup } from "react-dom/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { adminCopy } from "@/lib/copy/admin"

const callRpc = vi.fn()

vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({}) }))
vi.mock("@/lib/rpc", () => ({
  callRpc: (...args: unknown[]) => callRpc(...args),
}))
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NOT_FOUND")
  },
}))
// The lists and the dangerous actions have their own tests.
vi.mock("./attendee-list", () => ({ AttendeeList: () => null }))
vi.mock("./waitlist-list", () => ({ WaitlistList: () => null }))
vi.mock("./session-cancel", () => ({
  CANCEL_ANCHOR: "cancel-event",
  SessionCancel: () => null,
}))
vi.mock("./session-delete", () => ({ SessionDelete: () => null }))
vi.mock("./session-header", () => ({ SessionHeader: () => null }))

const { SessionDetailsContent } = await import("./page")

const ID = "00000000-0000-4000-8000-000000000001"

function details(extra: Record<string, unknown> = {}) {
  return {
    event: {
      id: ID,
      concept_name: "Grandma",
      kind: "regular",
      status: "published",
      starts_at: "2099-10-12T07:00:00Z",
      ends_at: "2099-10-12T09:00:00Z",
      capacity_adults: 12,
      occupied: 3,
      ...extra,
    },
    bookings: [],
    waitlist: [],
  }
}

function hrefs(html: string): string[] {
  return [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1])
}

beforeEach(() => {
  callRpc.mockReset()
})

// Story 4.9: the work sheet is the page's only link to it, for every status.
describe("the session details page", () => {
  it("links to the session's work sheet", async () => {
    callRpc.mockResolvedValue({ ok: true, data: details() })
    const html = renderToStaticMarkup(
      await SessionDetailsContent({ params: Promise.resolve({ id: ID }) })
    )
    expect(html).toContain(adminCopy.sessions.morningView)
    expect(hrefs(html)).toContain(`/admin/sessions/${ID}/work`)
    expect(hrefs(html)).not.toContain(`/admin/sessions/${ID}/day`)
  })

  it("a completed session still links to its work sheet", async () => {
    callRpc.mockResolvedValue({
      ok: true,
      data: details({
        status: "completed",
        starts_at: "2020-10-12T07:00:00Z",
        ends_at: "2020-10-12T09:00:00Z",
      }),
    })
    const html = renderToStaticMarkup(
      await SessionDetailsContent({ params: Promise.resolve({ id: ID }) })
    )
    expect(hrefs(html)).toEqual([`/admin/sessions/${ID}/work`])
  })
})
