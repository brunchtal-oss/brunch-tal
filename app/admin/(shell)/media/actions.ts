"use server"

import type { ActionResult } from "@/lib/errors"
import { signedDraftUrls } from "@/lib/media/drafts"
import { publicMediaUrl } from "@/lib/media/photo"
import { callRpc } from "@/lib/rpc"
import { createClient } from "@/lib/supabase/server"

// Choosing an already uploaded image (fix-media-picker, user decision
// 2026-11-05), for every image field (ImageUploadField). The list is the
// images on the site now (admin_list_media); a thumbnail is the published
// file of a member on the site (public, so next/image shrinks it), never the
// full draft file. Choosing makes a copy: admin_copy_media gives the new draft
// row, then the draft file is copied in media-drafts with the admin's own
// session (the storage policy allows writing only a draft row's name, as for
// an upload). From there the copy is a fresh upload. The RPCs enforce the
// admin; the actions check only the shape (AD-16).

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export type MediaChoice = {
  id: string
  url: string
  alt: string
  focusX: number
  focusY: number
}

type ListedRow = {
  id: string
  created_at: string
  alt_text: string | null
  focus_x: number
  focus_y: number
  public_path: string | null
}

export async function listMediaAction(): Promise<
  ActionResult<{ items: MediaChoice[] }>
> {
  const result = await callRpc(await createClient(), "admin_list_media")
  if (!result.ok) return result
  const rows = (result.data ?? []) as unknown as ListedRow[]
  const items: MediaChoice[] = []
  for (const row of rows) {
    // A family with no published member on the site (still copying) has no
    // thumbnail yet: left out.
    if (!row.public_path) continue
    items.push({
      id: row.id,
      url: publicMediaUrl(row.public_path),
      alt: row.alt_text ?? "",
      focusX: row.focus_x,
      focusY: row.focus_y,
    })
  }
  return { ok: true, data: { items } }
}

export async function copyMediaAction(input: {
  sourceId: string
  idempotencyKey: string
}): Promise<ActionResult<{ mediaId: string; previewUrl: string | null }>> {
  if (!UUID.test(input.sourceId) || !UUID.test(input.idempotencyKey)) {
    return { ok: false, code: "INVALID_INPUT" }
  }
  const client = await createClient()
  const result = await callRpc(client, "admin_copy_media", {
    p_source_id: input.sourceId,
    p_idempotency_key: input.idempotencyKey,
  })
  if (!result.ok) return result
  const copied = result.data as { media_id: string; source_path: string }

  const { error } = await client.storage
    .from("media-drafts")
    .copy(copied.source_path, copied.media_id)
  // "already exists": an earlier try copied it but its answer was lost (the
  // name is the new row's own id).
  const arrived =
    error &&
    ((error as { statusCode?: string }).statusCode === "409" ||
      /already exists|duplicate/i.test(error.message))
  if (error && !arrived) {
    console.error("media.copy_failed", {
      mediaId: copied.media_id,
      sourcePath: copied.source_path,
      message: error.message,
    })
    return { ok: false, code: "MEDIA_COPY_FAILED" }
  }

  const urls = await signedDraftUrls(client, [
    copied.media_id,
    copied.source_path,
  ])
  return {
    ok: true,
    data: {
      mediaId: copied.media_id,
      // The source's file is the same picture, if the new one is not signed.
      previewUrl: urls[copied.media_id] ?? urls[copied.source_path] ?? null,
    },
  }
}
