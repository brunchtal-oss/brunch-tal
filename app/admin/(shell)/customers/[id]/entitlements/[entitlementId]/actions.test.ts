import { beforeEach, describe, expect, it, vi } from "vitest"

import {
  correctEntitlementAction,
  previewCorrectEntitlementAction,
} from "./actions"

const callRpc = vi.fn()

vi.mock("@/lib/rpc", () => ({
  callRpc: (...args: unknown[]) => callRpc(...args),
}))
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ session: true }),
}))

const ID = "33333333-3333-4333-8333-333333333333"
const EVENT = "44444444-4444-4444-8444-444444444444"
const KEY = "22222222-2222-4222-8222-222222222222"
const INVALID = { ok: false, code: "INVALID_INPUT" }

const BASE = {
  entitlementId: ID,
  field: "units",
  value: 0 as unknown,
  relatedEventId: null as string | null,
  reason: "",
  confirmed: true,
  idempotencyKey: KEY,
}

beforeEach(() => {
  callRpc.mockReset()
  callRpc.mockResolvedValue({ ok: true, data: { affected_count: 2 } })
})

describe("card correction actions (story 3.13)", () => {
  it("units 0 reaches the RPC; a whitespace reason and no session are sent as null", async () => {
    await expect(
      correctEntitlementAction({ ...BASE, reason: "  \n " })
    ).resolves.toEqual({ ok: true, data: { affectedCount: 2 } })
    expect(callRpc).toHaveBeenLastCalledWith(
      { session: true },
      "admin_correct_entitlement",
      {
        p_entitlement_id: ID,
        p_field: "units",
        p_value: 0,
        p_related_event_id: null,
        p_reason: null,
        p_confirmed: true,
        p_idempotency_key: KEY,
      }
    )
  })

  it("weekdays null (every day) passes, with the session and the trimmed reason", async () => {
    await correctEntitlementAction({
      ...BASE,
      field: "allowed_weekdays",
      value: null,
      relatedEventId: EVENT,
      reason: " ביקשה ",
    })
    expect(callRpc).toHaveBeenLastCalledWith(
      { session: true },
      "admin_correct_entitlement",
      expect.objectContaining({
        p_field: "allowed_weekdays",
        p_value: null,
        p_related_event_id: EVENT,
        p_reason: "ביקשה",
      })
    )
  })

  it("the preview sends the field and the value", async () => {
    callRpc.mockResolvedValue({
      ok: true,
      data: { ok: false, code: "NO_CHANGE" },
    })
    await expect(
      previewCorrectEntitlementAction({
        entitlementId: ID,
        field: "allowed_weekdays",
        value: null,
      })
    ).resolves.toEqual({
      ok: true,
      data: { ok: false, code: "NO_CHANGE", field: null },
    })
    expect(callRpc).toHaveBeenLastCalledWith(
      { session: true },
      "preview_admin_correct_entitlement",
      { p_entitlement_id: ID, p_field: "allowed_weekdays", p_value: null }
    )
  })

  it("a bad id, field, value, session or key is INVALID_INPUT without calling the RPC", async () => {
    for (const input of [
      { ...BASE, entitlementId: "nope" },
      { ...BASE, field: "validity_days" },
      { ...BASE, value: -1 },
      { ...BASE, value: 100 },
      { ...BASE, value: 1.5 },
      { ...BASE, field: "expires_on", value: "15.11.2026" },
      { ...BASE, field: "allowed_weekdays", value: [7] },
      { ...BASE, relatedEventId: "x" },
      { ...BASE, reason: "x".repeat(2001) },
      { ...BASE, idempotencyKey: "x" },
    ]) {
      await expect(correctEntitlementAction(input)).resolves.toEqual(INVALID)
    }
    await expect(
      previewCorrectEntitlementAction({
        entitlementId: "nope",
        field: "units",
        value: 1,
      })
    ).resolves.toEqual(INVALID)
    expect(callRpc).not.toHaveBeenCalled()
  })
})
