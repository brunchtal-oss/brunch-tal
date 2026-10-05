"use server"

import { updateTag } from "next/cache"

import { schemaForSection } from "@/lib/content/schema"
import { visibleImages } from "@/lib/content/visible"
import type { ActionResult } from "@/lib/errors"
import { callRpc } from "@/lib/rpc"
import { deletePublicMedia, publishMedia } from "@/lib/server/privileged/media"
import { createClient } from "@/lib/supabase/server"

import {
  findSectionRef,
  hasPendingDraft,
  isEditableSlug,
  publishTags,
  type ContentObject,
  type ContentPage,
} from "./content-items"

// Save a section's draft and publish a page (stories 5.1, 5.3). The action
// is the shape gate (AD-16): only a section of the editor (slug, key) is
// saved, its draft is parsed with the section's zod schema
// (schemaForSection) before it is saved, and every draft that would be
// published is parsed again before admin_publish_content; the RPCs enforce the admin, the object and the
// version. After a publish the page's cache tags are updated (publishTags:
// the business details and the footer also update content:global). The
// idempotency key comes from the editor (AD-5).

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

async function readPage(
  client: Awaited<ReturnType<typeof createClient>>,
  slug: string
): Promise<ActionResult<ContentPage>> {
  const result = await callRpc(client, "admin_get_content_page", {
    p_slug: slug,
  })
  if (!result.ok) return result
  return { ok: true, data: result.data as unknown as ContentPage }
}

// A new image row (story 5.4): the browser then uploads the file to
// media-drafts/<mediaId> with the admin's session (the storage policy allows
// only that name). The key is one per chosen file (AD-5).
export async function createMediaAction(input: {
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

export async function saveContentDraftAction(input: {
  slug: string
  key: string
  content: unknown
}): Promise<ActionResult> {
  const ref = findSectionRef(input.slug, input.key)
  if (!ref) return { ok: false, code: "INVALID_INPUT" }

  const client = await createClient()
  const page = await readPage(client, ref.slug)
  if (!page.ok) return page
  const section = page.data.sections.find((s) => s.key === ref.key)
  if (!section) return { ok: false, code: "NOT_FOUND" }

  const schema = schemaForSection(ref.slug, ref.key, section.kind)
  const parsed = schema?.safeParse(input.content)
  if (!parsed?.success) {
    // The field's path: "title", or "items.2.text" in a list.
    const path = parsed?.error.issues[0]?.path
    return path && path.length > 0
      ? {
          ok: false,
          code: "INVALID_INPUT",
          detail: { field: path.map(String).join(".") },
        }
      : { ok: false, code: "INVALID_INPUT" }
  }

  // JSON drops the optional fields that were left empty (undefined).
  const content = JSON.parse(JSON.stringify(parsed.data))
  const saved = await callRpc(client, "admin_set_content_draft", {
    p_slug: ref.slug,
    p_key: ref.key,
    p_content: content,
  })
  if (!saved.ok) return saved
  return { ok: true, data: undefined }
}

// "Back to what the site shows" (story 5.3, user decision 2026-10-05): the
// section's draft becomes its published content ({} when it was never
// published), through admin_set_content_draft. No schema check: it copies
// what is already published. Returns that content, so the editor resets its
// form to it.
export async function discardContentDraftAction(input: {
  slug: string
  key: string
}): Promise<ActionResult<{ content: ContentObject }>> {
  const ref = findSectionRef(input.slug, input.key)
  if (!ref) return { ok: false, code: "INVALID_INPUT" }

  const client = await createClient()
  const page = await readPage(client, ref.slug)
  if (!page.ok) return page
  const section = page.data.sections.find((s) => s.key === ref.key)
  if (!section) return { ok: false, code: "NOT_FOUND" }

  const content = section.published_content ?? {}
  const saved = await callRpc(client, "admin_set_content_draft", {
    p_slug: ref.slug,
    p_key: ref.key,
    // A copy as JSON (the RPC's jsonb parameter).
    p_content: JSON.parse(JSON.stringify(content)),
  })
  if (!saved.ok) return saved
  return { ok: true, data: { content } }
}

export async function publishContentAction(input: {
  slug: string
  idempotencyKey: string
}): Promise<ActionResult<{ publishedVersion: number; changed: number }>> {
  if (!isEditableSlug(input.slug) || !UUID.test(input.idempotencyKey)) {
    return { ok: false, code: "INVALID_INPUT" }
  }

  const client = await createClient()
  const page = await readPage(client, input.slug)
  if (!page.ok) return page

  // Nothing is published unless every pending draft passes its schema.
  for (const section of page.data.sections.filter(hasPendingDraft)) {
    const schema = schemaForSection(input.slug, section.key, section.kind)
    if (!schema?.safeParse(section.draft_content).success) {
      return {
        ok: false,
        code: "INVALID_INPUT",
        detail: { field: section.key },
      }
    }
  }

  // Story 5.4 (AD-21): every image a pending draft shows is published first
  // (begin, copy, finish). An image whose upload did not finish
  // (MEDIA_NOT_UPLOADED) is skipped: the site leaves its item out. Any other
  // failure stops here, before the page is published; a retry continues.
  const seen = new Set<string>()
  for (const section of page.data.sections.filter(hasPendingDraft)) {
    for (const image of visibleImages(section.draft_content)) {
      if (seen.has(image.media_id)) continue
      seen.add(image.media_id)
      const done = await publishMedia(client, image)
      if (!done.ok && done.code !== "MEDIA_NOT_UPLOADED") return done
    }
  }

  const result = await callRpc(client, "admin_publish_content", {
    p_slug: input.slug,
    p_idempotency_key: input.idempotencyKey,
  })
  if (!result.ok) return result
  const published = result.data as {
    published_version: number
    changed: number
    hidden_paths?: string[]
  }

  // The RPC already marked them hidden; a failed delete is returned again by
  // the next publish.
  await deletePublicMedia(client, published.hidden_paths ?? [])

  for (const tag of publishTags(input.slug)) updateTag(tag)

  return {
    ok: true,
    data: {
      publishedVersion: published.published_version,
      changed: published.changed,
    },
  }
}
