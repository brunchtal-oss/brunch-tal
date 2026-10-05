import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"

import type { ActionResult } from "@/lib/errors"
import { callRpc } from "@/lib/rpc"
import type { Database } from "@/lib/supabase/database.types"

import { createServiceClient } from "./service-client"

// The Storage steps of publishing and hiding an image (story 5.4, AD-16,
// AD-21), the only place that copies between the buckets or deletes a
// public file. The RPCs before and after them hold the state
// (media_assets.publish_state), so each step is safe to repeat.

type StorageClient = Pick<ReturnType<typeof createServiceClient>, "storage">

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const PUBLIC_PATH =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jpg$/i

// Storage answers a copy onto an existing name with "already exists" (409).
function alreadyExists(error: { message?: string; statusCode?: string }) {
  return (
    error.statusCode === "409" ||
    /already exists|duplicate/i.test(error.message ?? "")
  )
}

/**
 * Copies media-drafts/<id> to media-public/<id>.jpg. A destination that
 * already exists counts as copied (a retry after a lost answer). true when
 * the public file is there.
 */
export async function copyMediaToPublic(
  mediaId: string,
  client: StorageClient = createServiceClient()
): Promise<boolean> {
  if (!UUID.test(mediaId)) return false
  const { error } = await client.storage
    .from("media-drafts")
    .copy(mediaId, `${mediaId}.jpg`, { destinationBucket: "media-public" })
  if (!error) return true
  const failure = error as { message?: string; statusCode?: string }
  if (alreadyExists(failure)) return true
  console.error("media.copy_failed", {
    mediaId,
    message: failure.message,
    statusCode: failure.statusCode,
  })
  return false
}

/**
 * Deletes public files (hidden_paths of admin_publish_content or
 * admin_set_event_image). Called only after the RPC marked them hidden. The
 * paths are checked again first with the admin's session (`client`, which
 * reads every media_assets row): only a file whose row is hidden right now
 * is deleted, so an image published again in between (or the paths of an
 * old result replayed by its idempotency key) keeps its file. A failure is
 * logged and the next publish returns the path again. true when the delete
 * was accepted (a missing file is not an error).
 */
export async function deletePublicMedia(
  client: Pick<SupabaseClient<Database>, "from">,
  paths: readonly string[],
  storage?: StorageClient
): Promise<boolean> {
  const valid = paths.filter((path) => PUBLIC_PATH.test(path))
  if (valid.length === 0) return true
  const { data, error: readError } = await client
    .from("media_assets")
    .select("public_path")
    .in("public_path", valid)
    .eq("publish_state", "hidden")
  if (readError) {
    console.error("media.delete_check_failed", {
      paths: valid,
      message: readError.message,
    })
    return false
  }
  const hidden = (data ?? []).map((row) => row.public_path)
  if (hidden.length === 0) return true
  const { error } = await (storage ?? createServiceClient()).storage
    .from("media-public")
    .remove(hidden)
  if (error) {
    console.error("media.delete_failed", {
      paths: hidden,
      message: error.message,
    })
    return false
  }
  return true
}

// An image to publish: its id, alt text (may be empty) and focus point.
export type MediaToPublish = {
  media_id: string
  alt?: string
  focus_x: number
  focus_y: number
}

/**
 * Publishes one image in the three steps of AD-21, with the admin's own
 * session for the RPCs (private.is_admin() inside): admin_begin_media_publish
 * (alt, focus, the intent), the copy to the public bucket, then
 * admin_finish_media_publish. An image that is already published only gets
 * its alt and focus. Each step is safe to repeat, so a retry continues from
 * the saved state. MEDIA_NOT_UPLOADED: the draft file is missing.
 */
export async function publishMedia(
  client: SupabaseClient<Database>,
  image: MediaToPublish,
  storage?: StorageClient
): Promise<ActionResult> {
  const begun = await callRpc(client, "admin_begin_media_publish", {
    p_media_id: image.media_id,
    p_alt_text: image.alt ?? "",
    p_focus_x: image.focus_x,
    p_focus_y: image.focus_y,
  })
  if (!begun.ok) return begun
  const state = (begun.data as { publish_state?: string }).publish_state
  if (state === "published") return { ok: true, data: undefined }

  if (!(await copyMediaToPublic(image.media_id, storage))) {
    return { ok: false, code: "MEDIA_NOT_COPIED" }
  }
  const finished = await callRpc(client, "admin_finish_media_publish", {
    p_media_id: image.media_id,
  })
  if (!finished.ok) return finished
  return { ok: true, data: undefined }
}
