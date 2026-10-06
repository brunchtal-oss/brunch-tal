import { beforeEach, describe, expect, it, vi } from "vitest"

import {
  addPrepDayAction,
  addWorkDishAction,
  addWorkTaskAction,
  deleteWorkDishAction,
  deleteWorkTaskAction,
  removePrepDayAction,
  setWorkDishOrderAction,
  setWorkTaskDoneAction,
  setWorkTaskOrderAction,
  updateWorkDishAction,
  updateWorkTaskAction,
} from "./actions"

const callRpc = vi.fn()

vi.mock("@/lib/rpc", () => ({
  callRpc: (...args: unknown[]) => callRpc(...args),
}))
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ session: true }),
}))

const ID = "33333333-3333-4333-8333-333333333333"
const KEY = "22222222-2222-4222-8222-222222222222"
const INVALID = { ok: false, code: "INVALID_INPUT" }

beforeEach(() => {
  callRpc.mockReset()
  callRpc.mockResolvedValue({ ok: true, data: { dish_id: ID } })
})

describe("the work sheet's actions (story 4.9)", () => {
  it("send each RPC its arguments and return ok without data", async () => {
    await expect(
      addWorkDishAction({ eventId: ID, name: "שקשוקה", idempotencyKey: KEY })
    ).resolves.toEqual({ ok: true, data: undefined })
    expect(callRpc).toHaveBeenLastCalledWith(
      { session: true },
      "admin_add_work_dish",
      { p_event_id: ID, p_name: "שקשוקה", p_idempotency_key: KEY }
    )

    await addWorkTaskAction({
      dishId: ID,
      dayOffset: -2,
      body: "פטה",
      idempotencyKey: KEY,
    })
    expect(callRpc).toHaveBeenLastCalledWith(
      { session: true },
      "admin_add_work_task",
      { p_dish_id: ID, p_day_offset: -2, p_body: "פטה", p_idempotency_key: KEY }
    )

    await setWorkTaskDoneAction({ taskId: ID, done: true })
    expect(callRpc).toHaveBeenLastCalledWith(
      { session: true },
      "admin_set_work_task_done",
      { p_task_id: ID, p_done: true }
    )

    await setWorkDishOrderAction({ ids: [ID, KEY] })
    expect(callRpc).toHaveBeenLastCalledWith(
      { session: true },
      "admin_set_work_dish_order",
      { p_ids: [ID, KEY] }
    )

    await removePrepDayAction({
      eventId: ID,
      dayOffset: 0,
      idempotencyKey: KEY,
    })
    expect(callRpc).toHaveBeenLastCalledWith(
      { session: true },
      "admin_remove_prep_day",
      { p_event_id: ID, p_day_offset: 0, p_idempotency_key: KEY }
    )
  })

  it("pass a refusal through", async () => {
    callRpc.mockResolvedValue({ ok: false, code: "CONCURRENT_CHANGE" })
    await expect(setWorkTaskOrderAction({ ids: [ID] })).resolves.toEqual({
      ok: false,
      code: "CONCURRENT_CHANGE",
    })
  })

  it("refuse a bad shape without calling the server", async () => {
    const bad = [
      addWorkDishAction({ eventId: "x", name: "a", idempotencyKey: KEY }),
      addWorkDishAction({ eventId: ID, name: "   ", idempotencyKey: KEY }),
      addWorkDishAction({
        eventId: ID,
        name: "א".repeat(201),
        idempotencyKey: KEY,
      }),
      addWorkDishAction({ eventId: ID, name: "a", idempotencyKey: "k" }),
      updateWorkDishAction({ dishId: ID, name: "", idempotencyKey: KEY }),
      deleteWorkDishAction({ dishId: "1", idempotencyKey: KEY }),
      addWorkTaskAction({
        dishId: ID,
        dayOffset: -7,
        body: "a",
        idempotencyKey: KEY,
      }),
      addWorkTaskAction({
        dishId: ID,
        dayOffset: 1,
        body: "a",
        idempotencyKey: KEY,
      }),
      addWorkTaskAction({
        dishId: ID,
        dayOffset: -1.5,
        body: "a",
        idempotencyKey: KEY,
      }),
      updateWorkTaskAction({
        taskId: ID,
        body: "a",
        dayOffset: NaN,
        idempotencyKey: KEY,
      }),
      deleteWorkTaskAction({ taskId: ID, idempotencyKey: "" }),
      setWorkTaskDoneAction({ taskId: ID, done: "yes" as unknown as boolean }),
      setWorkDishOrderAction({ ids: [] }),
      setWorkTaskOrderAction({ ids: [ID, "nope"] }),
      addPrepDayAction({ eventId: ID, dayOffset: -10, idempotencyKey: KEY }),
      removePrepDayAction({ eventId: ID, dayOffset: 2, idempotencyKey: KEY }),
    ]
    for (const result of await Promise.all(bad)) {
      expect(result).toEqual(INVALID)
    }
    expect(callRpc).not.toHaveBeenCalled()
  })
})
