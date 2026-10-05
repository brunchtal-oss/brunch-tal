"use server"

import { updateTag } from "next/cache"

import { schemaForSection } from "@/lib/content/schema"
import type { ActionResult } from "@/lib/errors"
import { callRpc } from "@/lib/rpc"
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

  const result = await callRpc(client, "admin_publish_content", {
    p_slug: input.slug,
    p_idempotency_key: input.idempotencyKey,
  })
  if (!result.ok) return result
  const published = result.data as {
    published_version: number
    changed: number
  }

  for (const tag of publishTags(input.slug)) updateTag(tag)

  return {
    ok: true,
    data: {
      publishedVersion: published.published_version,
      changed: published.changed,
    },
  }
}
