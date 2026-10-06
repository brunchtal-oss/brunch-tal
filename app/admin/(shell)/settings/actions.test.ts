import { beforeEach, describe, expect, it, vi } from "vitest"

import { updateSettingsAction } from "./actions"
import { updateTemplateAction } from "./templates/actions"

const callRpc = vi.fn()

vi.mock("@/lib/rpc", () => ({
  callRpc: (...args: unknown[]) => callRpc(...args),
}))
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ session: true }),
}))

const KEY = "22222222-2222-4222-8222-222222222222"

beforeEach(() => {
  callRpc.mockReset()
})

describe("updateSettingsAction", () => {
  it("sends the changes with the version the screen read", async () => {
    callRpc.mockResolvedValue({ ok: true, data: { version: 4 } })
    await expect(
      updateSettingsAction({
        changes: { default_capacity_regular: 14 },
        expectedVersion: 3,
        idempotencyKey: KEY,
      })
    ).resolves.toEqual({ ok: true, data: undefined })
    expect(callRpc).toHaveBeenCalledWith(
      { session: true },
      "admin_update_business_settings",
      {
        p_changes: { default_capacity_regular: 14 },
        p_expected_version: 3,
        p_idempotency_key: KEY,
      }
    )
  })

  it("refuses an unknown key, no change, a bad version or key without calling the RPC", async () => {
    const inputs: Parameters<typeof updateSettingsAction>[0][] = [
      { changes: { version: 9 }, expectedVersion: 3, idempotencyKey: KEY },
      { changes: {}, expectedVersion: 3, idempotencyKey: KEY },
      {
        changes: { cancel_window_hours: 24 },
        expectedVersion: 0,
        idempotencyKey: KEY,
      },
      {
        changes: { cancel_window_hours: 24 },
        expectedVersion: 3,
        idempotencyKey: "nope",
      },
    ]
    for (const input of inputs) {
      await expect(updateSettingsAction(input)).resolves.toEqual({
        ok: false,
        code: "INVALID_INPUT",
      })
    }
    expect(callRpc).not.toHaveBeenCalled()
  })

  it("passes STALE_VERSION through", async () => {
    callRpc.mockResolvedValue({ ok: false, code: "STALE_VERSION" })
    await expect(
      updateSettingsAction({
        changes: { cancel_window_hours: 24 },
        expectedVersion: 3,
        idempotencyKey: KEY,
      })
    ).resolves.toEqual({ ok: false, code: "STALE_VERSION" })
  })
})

describe("updateTemplateAction", () => {
  it("sends the title and body", async () => {
    callRpc.mockResolvedValue({ ok: true, data: {} })
    await updateTemplateAction({
      type: "booking_confirmed",
      title: "ההרשמה אושרה",
      body: "נתראה ב{date}",
      expectedVersion: 1,
      idempotencyKey: KEY,
    })
    expect(callRpc).toHaveBeenCalledWith(
      { session: true },
      "admin_update_notification_template",
      {
        p_type: "booking_confirmed",
        p_title: "ההרשמה אושרה",
        p_body: "נתראה ב{date}",
        p_expected_version: 1,
        p_idempotency_key: KEY,
      }
    )
  })

  it("sends a null body for an override type", async () => {
    callRpc.mockResolvedValue({ ok: true, data: {} })
    await updateTemplateAction({
      type: "broadcast",
      title: "הודעה",
      body: null,
      expectedVersion: 1,
      idempotencyKey: KEY,
    })
    expect(callRpc.mock.calls[0][2]).toMatchObject({ p_body: null })
  })

  it("refuses a bad shape and passes TEMPLATE_INVALID with its field", async () => {
    await expect(
      updateTemplateAction({
        type: "Bad Type",
        title: "x",
        body: null,
        expectedVersion: 1,
        idempotencyKey: KEY,
      })
    ).resolves.toEqual({ ok: false, code: "INVALID_INPUT" })
    expect(callRpc).not.toHaveBeenCalled()

    callRpc.mockResolvedValue({
      ok: false,
      code: "TEMPLATE_INVALID",
      detail: { field: "body" },
    })
    await expect(
      updateTemplateAction({
        type: "booking_cancelled",
        title: "x",
        body: "{expires_on}",
        expectedVersion: 1,
        idempotencyKey: KEY,
      })
    ).resolves.toEqual({
      ok: false,
      code: "TEMPLATE_INVALID",
      detail: { field: "body" },
    })
  })
})
