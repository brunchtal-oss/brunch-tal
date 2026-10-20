import { beforeEach, describe, expect, it, vi } from "vitest"

import {
  addTextAction,
  updateScheduleAction,
  updateTextAction,
} from "./actions"

const callRpc = vi.fn()

vi.mock("@/lib/rpc", () => ({
  callRpc: (...args: unknown[]) => callRpc(...args),
}))
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ session: true }),
}))

const KEY = "22222222-2222-4222-8222-222222222222"
const TEXT = "33333333-3333-4333-8333-333333333333"
const WEEK = [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
  weekday,
  time: "09:00",
}))

beforeEach(() => {
  callRpc.mockReset()
})

describe("updateScheduleAction (story 5.11)", () => {
  it("sends the schedule with the version the screen read", async () => {
    callRpc.mockResolvedValue({ ok: true, data: { version: 4 } })
    await expect(
      updateScheduleAction({
        schedule: WEEK,
        expectedVersion: 3,
        idempotencyKey: KEY,
      })
    ).resolves.toEqual({ ok: true, data: undefined })
    expect(callRpc).toHaveBeenCalledWith(
      { session: true },
      "admin_update_business_settings",
      {
        p_changes: { marketing_reminder_schedule: WEEK },
        p_expected_version: 3,
        p_idempotency_key: KEY,
      }
    )
  })

  it("an empty schedule is sent", async () => {
    callRpc.mockResolvedValue({ ok: true, data: {} })
    await expect(
      updateScheduleAction({
        schedule: [],
        expectedVersion: 3,
        idempotencyKey: KEY,
      })
    ).resolves.toEqual({ ok: true, data: undefined })
    expect(callRpc.mock.calls[0][2].p_changes).toEqual({
      marketing_reminder_schedule: [],
    })
  })

  it("8 slots, an extra key, a bad key or version: INVALID_INPUT without calling the RPC", async () => {
    const inputs = [
      {
        schedule: [...WEEK, { weekday: 0, time: "10:00" }],
        expectedVersion: 3,
        idempotencyKey: KEY,
      },
      {
        schedule: [{ weekday: 0, time: "09:00", note: "x" }],
        expectedVersion: 3,
        idempotencyKey: KEY,
      },
      { schedule: WEEK, expectedVersion: 3, idempotencyKey: "nope" },
      { schedule: WEEK, expectedVersion: 0, idempotencyKey: KEY },
    ] as Parameters<typeof updateScheduleAction>[0][]
    for (const input of inputs) {
      await expect(updateScheduleAction(input)).resolves.toEqual({
        ok: false,
        code: "INVALID_INPUT",
      })
    }
    expect(callRpc).not.toHaveBeenCalled()
  })

  it("passes STALE_VERSION through", async () => {
    callRpc.mockResolvedValue({ ok: false, code: "STALE_VERSION" })
    await expect(
      updateScheduleAction({
        schedule: WEEK,
        expectedVersion: 3,
        idempotencyKey: KEY,
      })
    ).resolves.toEqual({ ok: false, code: "STALE_VERSION" })
  })
})

describe("addTextAction (story 5.11)", () => {
  it("sends the body and the key", async () => {
    callRpc.mockResolvedValue({ ok: true, data: { text_id: TEXT } })
    await expect(
      addTextAction({ body: "סטורי אחד", idempotencyKey: KEY })
    ).resolves.toEqual({ ok: true, data: undefined })
    expect(callRpc).toHaveBeenCalledWith(
      { session: true },
      "admin_add_marketing_reminder_text",
      { p_body: "סטורי אחד", p_idempotency_key: KEY }
    )
  })

  it("a bad key or a huge body: INVALID_INPUT without calling the RPC", async () => {
    for (const input of [
      { body: "x", idempotencyKey: "nope" },
      { body: "x".repeat(2001), idempotencyKey: KEY },
    ]) {
      await expect(addTextAction(input)).resolves.toEqual({
        ok: false,
        code: "INVALID_INPUT",
      })
    }
    expect(callRpc).not.toHaveBeenCalled()
  })
})

describe("updateTextAction (story 5.11)", () => {
  it("sends the text, its body, active false and the version", async () => {
    callRpc.mockResolvedValue({ ok: true, data: { version: 3 } })
    await expect(
      updateTextAction({
        textId: TEXT,
        body: "תעלי משהו",
        active: false,
        expectedVersion: 2,
        idempotencyKey: KEY,
      })
    ).resolves.toEqual({ ok: true, data: undefined })
    expect(callRpc).toHaveBeenCalledWith(
      { session: true },
      "admin_update_marketing_reminder_text",
      {
        p_text_id: TEXT,
        p_body: "תעלי משהו",
        p_active: false,
        p_expected_version: 2,
        p_idempotency_key: KEY,
      }
    )
  })

  it("a bad text id, key or version: INVALID_INPUT without calling the RPC", async () => {
    const base = {
      textId: TEXT,
      body: "x",
      active: true,
      expectedVersion: 1,
      idempotencyKey: KEY,
    }
    for (const input of [
      { ...base, textId: "nope" },
      { ...base, idempotencyKey: "nope" },
      { ...base, expectedVersion: 0 },
      { ...base, active: "yes" as unknown as boolean },
    ]) {
      await expect(updateTextAction(input)).resolves.toEqual({
        ok: false,
        code: "INVALID_INPUT",
      })
    }
    expect(callRpc).not.toHaveBeenCalled()
  })

  it("passes STALE_VERSION and NOT_FOUND through", async () => {
    for (const code of ["STALE_VERSION", "NOT_FOUND"]) {
      callRpc.mockResolvedValueOnce({ ok: false, code })
      await expect(
        updateTextAction({
          textId: TEXT,
          body: "x",
          active: true,
          expectedVersion: 1,
          idempotencyKey: KEY,
        })
      ).resolves.toEqual({ ok: false, code })
    }
  })
})
