import { renderToStaticMarkup } from "react-dom/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

import type { SessionRow } from "../../session-draft"

const callRpc = vi.fn()
const editorRows: SessionRow[] = []
let eventRow: Record<string, unknown> | null = null

function chain() {
  const self = {
    select: () => self,
    eq: () => self,
    maybeSingle: async () => ({ data: eventRow, error: null }),
  }
  return self
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ from: () => chain() }),
}))
vi.mock("@/lib/rpc", () => ({
  callRpc: (...args: unknown[]) => callRpc(...args),
}))
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NOT_FOUND")
  },
  redirect: (url: string) => {
    throw new Error(`REDIRECT ${url}`)
  },
}))
vi.mock("../../product-choices", () => ({
  loadProductChoices: async () => [],
}))
// The editor has its own tests; here only the row it receives.
vi.mock("./session-editor", () => ({
  SessionEditor: ({ row }: { row: SessionRow }) => {
    editorRows.push(row)
    return null
  },
}))

const { EditSessionContent } = await import("./page")

const ID = "00000000-0000-4000-8000-000000000001"

const ROW = {
  id: ID,
  kind: "regular",
  description: null,
  starts_at: "2099-10-12T07:00:00Z",
  ends_at: "2099-10-12T09:00:00Z",
  registration_closes_at: "2099-10-11T17:00:00Z",
  registration_close_overridden: false,
  status: "published",
  display_price_agorot: null,
  concepts: { name: "Grandma" },
  image: null,
  event_products: [],
}

function details() {
  return {
    event: {
      id: ID,
      concept_name: "Grandma",
      kind: "regular",
      status: "published",
      starts_at: ROW.starts_at,
      ends_at: ROW.ends_at,
      capacity_adults: 14,
      occupied: 5,
    },
    bookings: [],
    waitlist: [],
  }
}

function render() {
  return EditSessionContent({
    params: Promise.resolve({ id: ID }),
    searchParams: Promise.resolve({}),
  })
}

beforeEach(() => {
  callRpc.mockReset()
  editorRows.length = 0
  eventRow = ROW
})

// Story 5.20: the capacity comes from admin_get_event_details, not from a
// direct read of events.capacity_adults.
describe("the session editor page", () => {
  it("hands the editor the RPC's capacity (not the places taken)", async () => {
    callRpc.mockResolvedValue({ ok: true, data: details() })
    renderToStaticMarkup(await render())
    expect(callRpc).toHaveBeenCalledWith(
      expect.anything(),
      "admin_get_event_details",
      { p_event_id: ID }
    )
    expect(editorRows).toHaveLength(1)
    expect(editorRows[0].capacity_adults).toBe(14)
  })

  it("the RPC says NOT_FOUND: notFound()", async () => {
    callRpc.mockResolvedValue({ ok: false, code: "NOT_FOUND" })
    await expect(render()).rejects.toThrow("NOT_FOUND")
    expect(editorRows).toHaveLength(0)
  })
})
