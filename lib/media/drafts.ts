import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"

import type { ImageMap } from "@/lib/content/visible"
import type { Database } from "@/lib/supabase/database.types"

// The admin's view of draft images (story 5.4): signed URLs of
// media-drafts/<id>, made with the admin's own session (the storage policy
// lets only an admin read drafts). Never cached, never public. An id whose
// file is missing (an upload that did not finish) is left out.

const DRAFT_URL_SECONDS = 60 * 60

export async function signedDraftUrls(
  client: SupabaseClient<Database>,
  ids: readonly string[]
): Promise<Record<string, string>> {
  const unique = [...new Set(ids)]
  if (unique.length === 0) return {}
  const { data, error } = await client.storage
    .from("media-drafts")
    .createSignedUrls(unique, DRAFT_URL_SECONDS)
  if (error || !data) {
    console.error("media.draft_urls_failed", {
      mediaIds: unique,
      message: error?.message,
    })
    return {}
  }
  const urls: Record<string, string> = {}
  for (const entry of data) {
    if (!entry.error && entry.signedUrl && entry.path) {
      urls[entry.path] = entry.signedUrl
    }
  }
  return urls
}

// The images of draft content for the admin preview: the draft file (not
// optimized, a signed URL) with the alt and focus the draft holds.
export async function draftImageMap(
  client: SupabaseClient<Database>,
  refs: readonly {
    media_id: string
    alt: string
    focus_x: number
    focus_y: number
  }[]
): Promise<ImageMap> {
  const urls = await signedDraftUrls(
    client,
    refs.map((ref) => ref.media_id)
  )
  const images: ImageMap = {}
  for (const ref of refs) {
    const src = urls[ref.media_id]
    if (!src) continue
    images[ref.media_id] = {
      src,
      alt: ref.alt,
      focusX: ref.focus_x,
      focusY: ref.focus_y,
      unoptimized: true,
    }
  }
  return images
}
