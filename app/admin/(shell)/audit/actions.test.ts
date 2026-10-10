import { beforeEach, describe, expect, it, vi } from "vitest"

import { loadAuditAction } from "./actions"
import type { AuditFilters } from "./audit-data"

const callRpc = vi.fn()

vi.mock("@/lib/rpc", () => ({
  callRpc: (...args: unknown[]) => callRpc(...args),
}))
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ session: true }),
}))

const EVENT = "11111111-1111-4111-8111-111111111111"
const CUSTOMER = "22222222-2222-4222-8222-222222222222"
const ROW_ID = "33333333-3333-4333-8333-333333333333"
const CREATED = "2026-10-10T09:15:00.123456+00:00"

const NO_FILTERS: AuditFilters = {
  eventId: null,
  customerId: null,
  from: "2026-09-10",
  to: "2026-10-10",
}

beforeEach(() => {
  callRpc.mockReset()
  callRpc.mockResolvedValue({ ok: true, data: { rows: [], has_more: false } })
})

describe("loadAuditAction (story 4.5)", () => {
  it("full filters and a cursor in jsonb form: the exact RPC args", async () => {
    await expect(
      loadAuditAction(
        {
          eventId: EVENT,
          customerId: CUSTOMER,
          from: "2026-10-01",
          to: "2026-10-10",
        },
        { createdAt: CREATED, id: ROW_ID }
      )
    ).resolves.toEqual({ ok: true, data: { items: [], next: null } })
    expect(callRpc).toHaveBeenLastCalledWith(
      { session: true },
      "admin_list_audit",
      {
        p_event_id: EVENT,
        p_customer_id: CUSTOMER,
        p_from: "2026-10-01",
        p_to: "2026-10-10",
        p_before_created_at: CREATED,
        p_before_id: ROW_ID,
      }
    )
  })

  it("null filters and no cursor: only the dates are sent", async () => {
    await loadAuditAction(NO_FILTERS, null)
    const args = callRpc.mock.lastCall?.[2] as Record<string, unknown>
    expect(
      Object.fromEntries(
        Object.entries(args).filter(([, value]) => value !== undefined)
      )
    ).toEqual({ p_from: "2026-09-10", p_to: "2026-10-10" })
  })

  it("bad filters -> INVALID_INPUT without the RPC", async () => {
    for (const filters of [
      { ...NO_FILTERS, eventId: "x" },
      { ...NO_FILTERS, customerId: "nope" },
      { ...NO_FILTERS, from: "2026-02-30" },
      { ...NO_FILTERS, to: "" },
      null,
    ]) {
      await expect(
        loadAuditAction(filters as unknown as AuditFilters, null)
      ).resolves.toEqual({ ok: false, code: "INVALID_INPUT" })
    }
    expect(callRpc).not.toHaveBeenCalled()
  })

  it("a bad or partial cursor -> INVALID_INPUT without the RPC", async () => {
    for (const cursor of [
      { createdAt: CREATED },
      { id: ROW_ID },
      { createdAt: "2026-10-10", id: ROW_ID },
      { createdAt: "2026-10-10T::::+00:00", id: ROW_ID },
      { createdAt: CREATED, id: "x" },
      "cursor",
    ]) {
      await expect(
        loadAuditAction(NO_FILTERS, cursor as never)
      ).resolves.toEqual({ ok: false, code: "INVALID_INPUT" })
    }
    expect(callRpc).not.toHaveBeenCalled()
  })

  it("passes an RPC failure on with its detail", async () => {
    callRpc.mockResolvedValue({
      ok: false,
      code: "INVALID_INPUT",
      detail: { field: "to" },
    })
    await expect(loadAuditAction(NO_FILTERS, null)).resolves.toEqual({
      ok: false,
      code: "INVALID_INPUT",
      detail: { field: "to" },
    })
  })
})
