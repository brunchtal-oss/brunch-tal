"use server"

import type { ActionResult } from "@/lib/errors"
import { callRpc } from "@/lib/rpc"
import { createClient } from "@/lib/supabase/server"

// The work sheet's writes (story 4.9). Each RPC runs with the admin's own
// session (private.is_admin() inside) and checks everything again; these
// actions check only the shape. The idempotency key is made on the screen
// when a form opens (AD-5); "done" and ordering take none.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
// A list longer than this is not a sheet's dishes or a day's tasks.
const MAX_IDS = 500

const INVALID: ActionResult<never> = { ok: false, code: "INVALID_INPUT" }

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value)
}

// A dish name or a task: 1 to 200 characters after trimming (the RPC trims
// and checks again).
function isText(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.trim().length >= 1 &&
    value.trim().length <= 200
  )
}

function isOffset(value: unknown): value is number {
  return (
    Number.isInteger(value) && (value as number) >= -6 && (value as number) <= 0
  )
}

function isIdList(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length >= 1 &&
    value.length <= MAX_IDS &&
    value.every(isUuid)
  )
}

function done(result: ActionResult<unknown>): ActionResult {
  if (!result.ok) return result
  return { ok: true, data: undefined }
}

export async function addWorkDishAction(input: {
  eventId: string
  name: string
  idempotencyKey: string
}): Promise<ActionResult> {
  if (
    !isUuid(input?.eventId) ||
    !isText(input.name) ||
    !isUuid(input.idempotencyKey)
  ) {
    return INVALID
  }
  return done(
    await callRpc(await createClient(), "admin_add_work_dish", {
      p_event_id: input.eventId,
      p_name: input.name,
      p_idempotency_key: input.idempotencyKey,
    })
  )
}

export async function updateWorkDishAction(input: {
  dishId: string
  name: string
  idempotencyKey: string
}): Promise<ActionResult> {
  if (
    !isUuid(input?.dishId) ||
    !isText(input.name) ||
    !isUuid(input.idempotencyKey)
  ) {
    return INVALID
  }
  return done(
    await callRpc(await createClient(), "admin_update_work_dish", {
      p_dish_id: input.dishId,
      p_name: input.name,
      p_idempotency_key: input.idempotencyKey,
    })
  )
}

export async function deleteWorkDishAction(input: {
  dishId: string
  idempotencyKey: string
}): Promise<ActionResult> {
  if (!isUuid(input?.dishId) || !isUuid(input.idempotencyKey)) return INVALID
  return done(
    await callRpc(await createClient(), "admin_delete_work_dish", {
      p_dish_id: input.dishId,
      p_idempotency_key: input.idempotencyKey,
    })
  )
}

export async function setWorkDishOrderAction(input: {
  ids: string[]
}): Promise<ActionResult> {
  if (!isIdList(input?.ids)) return INVALID
  return done(
    await callRpc(await createClient(), "admin_set_work_dish_order", {
      p_ids: input.ids,
    })
  )
}

export async function addWorkTaskAction(input: {
  dishId: string
  dayOffset: number
  body: string
  idempotencyKey: string
}): Promise<ActionResult> {
  if (
    !isUuid(input?.dishId) ||
    !isOffset(input.dayOffset) ||
    !isText(input.body) ||
    !isUuid(input.idempotencyKey)
  ) {
    return INVALID
  }
  return done(
    await callRpc(await createClient(), "admin_add_work_task", {
      p_dish_id: input.dishId,
      p_day_offset: input.dayOffset,
      p_body: input.body,
      p_idempotency_key: input.idempotencyKey,
    })
  )
}

export async function updateWorkTaskAction(input: {
  taskId: string
  body: string
  dayOffset: number
  idempotencyKey: string
}): Promise<ActionResult> {
  if (
    !isUuid(input?.taskId) ||
    !isText(input.body) ||
    !isOffset(input.dayOffset) ||
    !isUuid(input.idempotencyKey)
  ) {
    return INVALID
  }
  return done(
    await callRpc(await createClient(), "admin_update_work_task", {
      p_task_id: input.taskId,
      p_body: input.body,
      p_day_offset: input.dayOffset,
      p_idempotency_key: input.idempotencyKey,
    })
  )
}

export async function deleteWorkTaskAction(input: {
  taskId: string
  idempotencyKey: string
}): Promise<ActionResult> {
  if (!isUuid(input?.taskId) || !isUuid(input.idempotencyKey)) return INVALID
  return done(
    await callRpc(await createClient(), "admin_delete_work_task", {
      p_task_id: input.taskId,
      p_idempotency_key: input.idempotencyKey,
    })
  )
}

export async function setWorkTaskDoneAction(input: {
  taskId: string
  done: boolean
}): Promise<ActionResult> {
  if (!isUuid(input?.taskId) || typeof input.done !== "boolean") {
    return INVALID
  }
  return done(
    await callRpc(await createClient(), "admin_set_work_task_done", {
      p_task_id: input.taskId,
      p_done: input.done,
    })
  )
}

export async function setWorkTaskOrderAction(input: {
  ids: string[]
}): Promise<ActionResult> {
  if (!isIdList(input?.ids)) return INVALID
  return done(
    await callRpc(await createClient(), "admin_set_work_task_order", {
      p_ids: input.ids,
    })
  )
}

export async function addPrepDayAction(input: {
  eventId: string
  dayOffset: number
  idempotencyKey: string
}): Promise<ActionResult> {
  if (
    !isUuid(input?.eventId) ||
    !isOffset(input.dayOffset) ||
    !isUuid(input.idempotencyKey)
  ) {
    return INVALID
  }
  return done(
    await callRpc(await createClient(), "admin_add_prep_day", {
      p_event_id: input.eventId,
      p_day_offset: input.dayOffset,
      p_idempotency_key: input.idempotencyKey,
    })
  )
}

export async function removePrepDayAction(input: {
  eventId: string
  dayOffset: number
  idempotencyKey: string
}): Promise<ActionResult> {
  if (
    !isUuid(input?.eventId) ||
    !isOffset(input.dayOffset) ||
    !isUuid(input.idempotencyKey)
  ) {
    return INVALID
  }
  return done(
    await callRpc(await createClient(), "admin_remove_prep_day", {
      p_event_id: input.eventId,
      p_day_offset: input.dayOffset,
      p_idempotency_key: input.idempotencyKey,
    })
  )
}
