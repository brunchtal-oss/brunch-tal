import { beforeEach, describe, expect, it, vi } from "vitest"

import {
  addPrepDayAction,
  addShoppingItemsAction,
  addWorkDishAction,
  addWorkTaskAction,
  deleteShoppingItemAction,
  deleteWorkDishAction,
  deleteWorkTaskAction,
  movePrepDayAction,
  removePrepDayAction,
  setShoppingItemBoughtAction,
  setShoppingItemOrderAction,
  setWorkDishOrderAction,
  setWorkTaskDoneAction,
  setWorkTaskOrderAction,
  updateShoppingItemAction,
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

    await movePrepDayAction({
      eventId: ID,
      from: -2,
      to: -4,
      idempotencyKey: KEY,
    })
    expect(callRpc).toHaveBeenLastCalledWith(
      { session: true },
      "admin_move_prep_day",
      { p_event_id: ID, p_from: -2, p_to: -4, p_idempotency_key: KEY }
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
      movePrepDayAction({ eventId: ID, from: -2, to: -7, idempotencyKey: KEY }),
      movePrepDayAction({ eventId: ID, from: 1, to: -3, idempotencyKey: KEY }),
      movePrepDayAction({
        eventId: "x",
        from: -2,
        to: -3,
        idempotencyKey: KEY,
      }),
      movePrepDayAction({ eventId: ID, from: -2, to: -3, idempotencyKey: "" }),
    ]
    for (const result of await Promise.all(bad)) {
      expect(result).toEqual(INVALID)
    }
    expect(callRpc).not.toHaveBeenCalled()
  })
})

describe("the shopping list's actions (story 4.10)", () => {
  it("send each RPC its arguments", async () => {
    await expect(
      addShoppingItemsAction({
        eventId: ID,
        bodies: ["פטה כבשים", "עגבניות", "לחם"],
        idempotencyKey: KEY,
      })
    ).resolves.toEqual({ ok: true, data: undefined })
    expect(callRpc).toHaveBeenLastCalledWith(
      { session: true },
      "admin_add_shopping_items",
      {
        p_event_id: ID,
        p_bodies: ["פטה כבשים", "עגבניות", "לחם"],
        p_idempotency_key: KEY,
      }
    )
    await updateShoppingItemAction({
      itemId: ID,
      body: "לימונים",
      quantity: "",
      idempotencyKey: KEY,
    })
    expect(callRpc).toHaveBeenLastCalledWith(
      { session: true },
      "admin_update_shopping_item",
      {
        p_item_id: ID,
        p_body: "לימונים",
        p_quantity: "",
        p_idempotency_key: KEY,
      }
    )
    await deleteShoppingItemAction({ itemId: ID, idempotencyKey: KEY })
    expect(callRpc).toHaveBeenLastCalledWith(
      { session: true },
      "admin_delete_shopping_item",
      { p_item_id: ID, p_idempotency_key: KEY }
    )
    await setShoppingItemBoughtAction({ itemId: ID, bought: true })
    expect(callRpc).toHaveBeenLastCalledWith(
      { session: true },
      "admin_set_shopping_item_bought",
      { p_item_id: ID, p_bought: true }
    )
    await setShoppingItemOrderAction({ ids: [KEY, ID] })
    expect(callRpc).toHaveBeenLastCalledWith(
      { session: true },
      "admin_set_shopping_item_order",
      { p_ids: [KEY, ID] }
    )
  })

  it("refuse a bad shape without calling the server", async () => {
    const items = { eventId: ID, bodies: ["a"], idempotencyKey: KEY }
    const bad = [
      addShoppingItemsAction({ ...items, eventId: "x" }),
      addShoppingItemsAction({ ...items, bodies: [] }),
      addShoppingItemsAction({ ...items, bodies: ["a", " "] }),
      addShoppingItemsAction({ ...items, bodies: ["א".repeat(201)] }),
      addShoppingItemsAction({
        ...items,
        bodies: Array.from({ length: 101 }, () => "a"),
      }),
      addShoppingItemsAction({
        ...items,
        bodies: "a" as unknown as string[],
      }),
      addShoppingItemsAction({ ...items, idempotencyKey: "k" }),
      updateShoppingItemAction({
        itemId: ID,
        body: "a",
        quantity: "8".repeat(51),
        idempotencyKey: KEY,
      }),
      updateShoppingItemAction({
        itemId: "1",
        body: "a",
        quantity: "",
        idempotencyKey: KEY,
      }),
      deleteShoppingItemAction({ itemId: ID, idempotencyKey: "" }),
      setShoppingItemBoughtAction({
        itemId: ID,
        bought: "yes" as unknown as boolean,
      }),
      setShoppingItemOrderAction({ ids: [] }),
      setShoppingItemOrderAction({ ids: [ID, "nope"] }),
    ]
    for (const result of await Promise.all(bad)) {
      expect(result).toEqual(INVALID)
    }
    expect(callRpc).not.toHaveBeenCalled()
  })
})
