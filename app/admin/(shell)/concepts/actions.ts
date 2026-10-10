"use server"

import type { ActionResult } from "@/lib/errors"
import { isPlainObject } from "@/lib/form-values"
import { callRpc } from "@/lib/rpc"
import { deletePublicMedia, publishMedia } from "@/lib/server/privileged/media"
import { createClient } from "@/lib/supabase/server"

// Concepts (story 4.8). Every RPC runs with the admin's own session
// (private.is_admin() inside, AD-4) and checks every value again; these
// actions only check the shape. The idempotency key comes from the screen
// (one per form load or per change, AD-5).

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const CONCEPT_KEYS = ["name", "description", "default_kind"]

function conceptShape(value: unknown): value is Record<string, unknown> {
  return (
    isPlainObject(value) &&
    Object.keys(value).every((key) => CONCEPT_KEYS.includes(key))
  )
}

export async function createConceptAction(input: {
  concept: Record<string, unknown>
  idempotencyKey: string
}): Promise<ActionResult<{ conceptId: string }>> {
  if (!conceptShape(input.concept) || !UUID.test(input.idempotencyKey)) {
    return { ok: false, code: "INVALID_INPUT" }
  }
  const result = await callRpc(await createClient(), "admin_create_concept", {
    p_concept: input.concept as Record<string, string | null>,
    p_idempotency_key: input.idempotencyKey,
  })
  if (!result.ok) return result
  const created = result.data as { concept_id: string }
  return { ok: true, data: { conceptId: created.concept_id } }
}

// The name, description and default kind (a subset).
export async function updateConceptAction(input: {
  conceptId: string
  changes: Record<string, unknown>
  idempotencyKey: string
}): Promise<ActionResult> {
  if (
    !UUID.test(input.conceptId) ||
    !conceptShape(input.changes) ||
    !UUID.test(input.idempotencyKey)
  ) {
    return { ok: false, code: "INVALID_INPUT" }
  }
  const result = await callRpc(await createClient(), "admin_update_concept", {
    p_concept_id: input.conceptId,
    p_changes: input.changes as Record<string, string | null>,
    p_idempotency_key: input.idempotencyKey,
  })
  if (!result.ok) return result
  return { ok: true, data: undefined }
}

// Archive (true) or restore (false): an absolute value, no key.
export async function setConceptArchivedAction(input: {
  conceptId: string
  archived: boolean
}): Promise<ActionResult> {
  if (!UUID.test(input.conceptId) || typeof input.archived !== "boolean") {
    return { ok: false, code: "INVALID_INPUT" }
  }
  const result = await callRpc(
    await createClient(),
    "admin_set_concept_archived",
    { p_concept_id: input.conceptId, p_archived: input.archived }
  )
  if (!result.ok) return result
  return { ok: true, data: undefined }
}

// Deletes a concept no session uses (CONCEPT_IN_USE otherwise). Its image
// may be hidden by the RPC; its public file is deleted here, after it.
export async function deleteConceptAction(input: {
  conceptId: string
  idempotencyKey: string
}): Promise<ActionResult> {
  if (!UUID.test(input.conceptId) || !UUID.test(input.idempotencyKey)) {
    return { ok: false, code: "INVALID_INPUT" }
  }
  const client = await createClient()
  const result = await callRpc(client, "admin_delete_concept", {
    p_concept_id: input.conceptId,
    p_idempotency_key: input.idempotencyKey,
  })
  if (!result.ok) return result
  const deleted = result.data as { hidden_paths?: string[] }
  await deletePublicMedia(client, deleted.hidden_paths ?? [])
  return { ok: true, data: undefined }
}

// A new image row for a concept's image; the browser then uploads the file
// to media-drafts/<mediaId>.
export async function createConceptMediaAction(input: {
  idempotencyKey: string
}): Promise<ActionResult<{ mediaId: string }>> {
  if (!UUID.test(input.idempotencyKey)) {
    return { ok: false, code: "INVALID_INPUT" }
  }
  const result = await callRpc(await createClient(), "admin_create_media", {
    p_idempotency_key: input.idempotencyKey,
  })
  if (!result.ok) return result
  const created = result.data as { media_id: string }
  return { ok: true, data: { mediaId: created.media_id } }
}

function isFocus(value: unknown): value is number {
  return (
    Number.isInteger(value) &&
    (value as number) >= 0 &&
    (value as number) <= 100
  )
}

// A concept's image, as a session's (setSessionImageAction): saving
// publishes the image (AD-21: begin, copy, finish) and then sets it with
// admin_set_concept_image; null removes it. An image nothing uses any more
// is hidden by the RPC, and its public file is deleted here, after it.
export async function setConceptImageAction(input: {
  conceptId: string
  image: {
    media_id: string
    alt: string
    focus_x: number
    focus_y: number
  } | null
}): Promise<ActionResult> {
  const image = input.image
  if (
    !UUID.test(input.conceptId) ||
    (image !== null &&
      (typeof image !== "object" ||
        !UUID.test(image.media_id) ||
        typeof image.alt !== "string" ||
        image.alt.length > 300 ||
        !isFocus(image.focus_x) ||
        !isFocus(image.focus_y)))
  ) {
    return { ok: false, code: "INVALID_INPUT" }
  }

  const client = await createClient()
  if (image) {
    const published = await publishMedia(client, image)
    if (!published.ok) return published
  }
  const result = await callRpc(client, "admin_set_concept_image", {
    p_concept_id: input.conceptId,
    // null removes the image (the generated type has no null for uuid).
    p_media_id: image ? image.media_id : (null as unknown as string),
  })
  if (!result.ok) return result
  const saved = result.data as { hidden_paths?: string[] }
  await deletePublicMedia(client, saved.hidden_paths ?? [])
  return { ok: true, data: undefined }
}
