import { renderToStaticMarkup } from "react-dom/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { adminCopy } from "@/lib/copy/admin"

import type { WorkSheet } from "./work-sheet-data"

const callRpc = vi.fn()

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }))
vi.mock("@/lib/rpc", () => ({
  callRpc: (...args: unknown[]) => callRpc(...args),
}))
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ session: true }),
}))

const { WorkSheetView } = await import("./work-sheet")
const { loadWorkSheet } = await import("./load-work-sheet")

const copy = adminCopy.work
const ID = "33333333-3333-4333-8333-333333333333"

const SHEET: WorkSheet = {
  event: {
    id: ID,
    conceptName: "יווני",
    status: "published",
    startsAt: "2026-10-22T07:00:00+00:00",
    endsAt: "2026-10-22T09:00:00+00:00",
  },
  prepDays: [
    { offset: -1, date: "2026-10-21" },
    { offset: 0, date: "2026-10-22" },
  ],
  addableDays: [{ offset: -2, date: "2026-10-20" }],
  dishes: [],
}

beforeEach(() => {
  callRpc.mockReset()
})

describe("the work sheet's screens (story 4.9)", () => {
  it("a session without dishes shows the empty-state and its one action", () => {
    const html = renderToStaticMarkup(<WorkSheetView sheet={SHEET} />)
    expect(html).toContain(copy.empty)
    // "+ מנה" only inside the empty-state, not also above it.
    expect(html.split(copy.addDish)).toHaveLength(2)
    expect(html).toContain(copy.addDay)
  })

  it("an unknown session loads as null (the page's notFound)", async () => {
    callRpc.mockResolvedValue({ ok: false, code: "NOT_FOUND" })
    await expect(loadWorkSheet(ID)).resolves.toBeNull()
    expect(callRpc).toHaveBeenCalledWith(
      { session: true },
      "admin_get_work_sheet",
      { p_event_id: ID }
    )
    callRpc.mockResolvedValue({ ok: false, code: "SERVER_ERROR" })
    await expect(loadWorkSheet(ID)).rejects.toThrow()
  })
})
