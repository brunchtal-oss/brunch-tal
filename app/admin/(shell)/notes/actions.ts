"use server"

import type { ActionResult } from "@/lib/errors"
import { callRpc } from "@/lib/rpc"
import { createClient } from "@/lib/supabase/server"

import { MAX_NOTE_BODY, MAX_TOPIC_NAME } from "./notes-data"

// The notes tab's writes (story 4.11). Each RPC runs with the admin's own
// session (private.is_admin() inside) and checks everything again; these
// actions check only the shape. The idempotency key is made on the screen
// when a form opens (AD-5); pinned, done, archived and ordering take none.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
// A list longer than this is not a topic's notes or the topics.
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

function idFrom(data: unknown, key: string): string | null {
  if (typeof data !== "object" || data === null) return null
  const value = (data as Record<string, unknown>)[key]
  return isUuid(value) ? value : null
}

// ---------------------------------------------------------------------------
// Topics
// ---------------------------------------------------------------------------

export async function addNoteTopicAction(input: {
  name: string
  idempotencyKey: string
}): Promise<ActionResult<{ topicId: string }>> {
  if (!isText(input?.name, MAX_TOPIC_NAME) || !isUuid(input.idempotencyKey)) {
    return INVALID
  }
  const result = await callRpc(await createClient(), "admin_add_note_topic", {
    p_name: input.name,
    p_idempotency_key: input.idempotencyKey,
  })
  if (!result.ok) return result
  const topicId = idFrom(result.data, "topic_id")
  if (!topicId) return { ok: false, code: "SERVER_ERROR" }
  return { ok: true, data: { topicId } }
}

export async function renameNoteTopicAction(input: {
  topicId: string
  name: string
  idempotencyKey: string
}): Promise<ActionResult> {
  if (
    !isUuid(input?.topicId) ||
    !isText(input.name, MAX_TOPIC_NAME) ||
    !isUuid(input.idempotencyKey)
  ) {
    return INVALID
  }
  return done(
    await callRpc(await createClient(), "admin_rename_note_topic", {
      p_topic_id: input.topicId,
      p_name: input.name,
      p_idempotency_key: input.idempotencyKey,
    })
  )
}

// The plan of a topic delete, for the sensitive dialog: how many notes
// (archived ones included) go with it.
export async function previewDeleteNoteTopicAction(input: {
  topicId: string
}): Promise<ActionResult<{ name: string; noteCount: number }>> {
  if (!isUuid(input?.topicId)) return INVALID
  const result = await callRpc(
    await createClient(),
    "preview_admin_delete_note_topic",
    { p_topic_id: input.topicId }
  )
  if (!result.ok) return result
  const data = result.data as Record<string, unknown> | null
  const name = data?.name
  const noteCount = data?.note_count
  if (
    typeof name !== "string" ||
    typeof noteCount !== "number" ||
    !Number.isInteger(noteCount) ||
    noteCount < 0
  ) {
    return { ok: false, code: "SERVER_ERROR" }
  }
  return { ok: true, data: { name, noteCount } }
}

export async function deleteNoteTopicAction(input: {
  topicId: string
  confirmed: boolean
  idempotencyKey: string
}): Promise<ActionResult> {
  if (
    !isUuid(input?.topicId) ||
    typeof input.confirmed !== "boolean" ||
    !isUuid(input.idempotencyKey)
  ) {
    return INVALID
  }
  return done(
    await callRpc(await createClient(), "admin_delete_note_topic", {
      p_topic_id: input.topicId,
      p_confirmed: input.confirmed,
      p_idempotency_key: input.idempotencyKey,
    })
  )
}

export async function setNoteTopicOrderAction(input: {
  ids: string[]
}): Promise<ActionResult> {
  if (!isIdList(input?.ids)) return INVALID
  return done(
    await callRpc(await createClient(), "admin_set_note_topic_order", {
      p_ids: input.ids,
    })
  )
}

// ---------------------------------------------------------------------------
// Notes
// ---------------------------------------------------------------------------

export async function addNoteAction(input: {
  topicId: string
  body: string
  idempotencyKey: string
}): Promise<ActionResult> {
  if (
    !isUuid(input?.topicId) ||
    !isText(input.body, MAX_NOTE_BODY) ||
    !isUuid(input.idempotencyKey)
  ) {
    return INVALID
  }
  return done(
    await callRpc(await createClient(), "admin_add_note", {
      p_topic_id: input.topicId,
      p_body: input.body,
      p_idempotency_key: input.idempotencyKey,
    })
  )
}

// The body and the topic (a move when it is another topic).
export async function updateNoteAction(input: {
  noteId: string
  topicId: string
  body: string
  idempotencyKey: string
}): Promise<ActionResult> {
  if (
    !isUuid(input?.noteId) ||
    !isUuid(input.topicId) ||
    !isText(input.body, MAX_NOTE_BODY) ||
    !isUuid(input.idempotencyKey)
  ) {
    return INVALID
  }
  return done(
    await callRpc(await createClient(), "admin_update_note", {
      p_note_id: input.noteId,
      p_topic_id: input.topicId,
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

// The full list of the topic's notes (archived ones included).
export async function setNoteOrderAction(input: {
  topicId: string
  ids: string[]
}): Promise<ActionResult> {
  if (!isUuid(input?.topicId) || !isIdList(input.ids)) return INVALID
  return done(
    await callRpc(await createClient(), "admin_set_note_order", {
      p_topic_id: input.topicId,
      p_ids: input.ids,
    })
  )
}
