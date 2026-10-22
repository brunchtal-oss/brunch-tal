"use server"

import type { ActionResult } from "@/lib/errors"
import { callRpc } from "@/lib/rpc"
import { createClient } from "@/lib/supabase/server"

import { MAX_NOTE_BODY } from "./notes-data"

// The notes tab's writes (story 4.11, fix 13: one board). Each RPC runs with the admin's own
// session (private.is_admin() inside) and checks everything again; these
// actions check only the shape. The idempotency key is made on the screen
// when a form opens (AD-5); pinned, done, archived and ordering take none.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
// A list longer than this is not the board's notes.
const MAX_IDS = 1000

const INVALID: ActionResult<never> = { ok: false, code: "INVALID_INPUT" }

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value)
}

// 1 to max characters after trimming (the RPC trims and checks again).
function isText(value: unknown, max: number): value is string {
  return (
    typeof value === "string" &&
    value.trim().length >= 1 &&
    value.trim().length <= max
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

// ---------------------------------------------------------------------------
// Notes
// ---------------------------------------------------------------------------

export async function addNoteAction(input: {
  body: string
  idempotencyKey: string
}): Promise<ActionResult> {
  if (!isText(input?.body, MAX_NOTE_BODY) || !isUuid(input.idempotencyKey)) {
    return INVALID
  }
  return done(
    await callRpc(await createClient(), "admin_add_note", {
      p_body: input.body,
      p_idempotency_key: input.idempotencyKey,
    })
  )
}

export async function updateNoteAction(input: {
  noteId: string
  body: string
  idempotencyKey: string
}): Promise<ActionResult> {
  if (
    !isUuid(input?.noteId) ||
    !isText(input.body, MAX_NOTE_BODY) ||
    !isUuid(input.idempotencyKey)
  ) {
    return INVALID
  }
  return done(
    await callRpc(await createClient(), "admin_update_note", {
      p_note_id: input.noteId,
      p_body: input.body,
      p_idempotency_key: input.idempotencyKey,
    })
  )
}

export async function deleteNoteAction(input: {
  noteId: string
  idempotencyKey: string
}): Promise<ActionResult> {
  if (!isUuid(input?.noteId) || !isUuid(input.idempotencyKey)) return INVALID
  return done(
    await callRpc(await createClient(), "admin_delete_note", {
      p_note_id: input.noteId,
      p_idempotency_key: input.idempotencyKey,
    })
  )
}

export async function setNotePinnedAction(input: {
  noteId: string
  pinned: boolean
}): Promise<ActionResult> {
  if (!isUuid(input?.noteId) || typeof input.pinned !== "boolean") {
    return INVALID
  }
  return done(
    await callRpc(await createClient(), "admin_set_note_pinned", {
      p_note_id: input.noteId,
      p_pinned: input.pinned,
    })
  )
}

export async function setNoteDoneAction(input: {
  noteId: string
  done: boolean
}): Promise<ActionResult> {
  if (!isUuid(input?.noteId) || typeof input.done !== "boolean") {
    return INVALID
  }
  return done(
    await callRpc(await createClient(), "admin_set_note_done", {
      p_note_id: input.noteId,
      p_done: input.done,
    })
  )
}

export async function setNoteArchivedAction(input: {
  noteId: string
  archived: boolean
}): Promise<ActionResult> {
  if (!isUuid(input?.noteId) || typeof input.archived !== "boolean") {
    return INVALID
  }
  return done(
    await callRpc(await createClient(), "admin_set_note_archived", {
      p_note_id: input.noteId,
      p_archived: input.archived,
    })
  )
}

// The full list of the board's notes (archived ones included).
export async function setNoteOrderAction(input: {
  ids: string[]
}): Promise<ActionResult> {
  if (!isIdList(input?.ids)) return INVALID
  return done(
    await callRpc(await createClient(), "admin_set_note_order", {
      p_ids: input.ids,
    })
  )
}
