"use server"

import { updateTag } from "next/cache"

import { schemaForKind } from "@/lib/content/schema"
import type { ActionResult } from "@/lib/errors"
import { callRpc } from "@/lib/rpc"
import { createClient } from "@/lib/supabase/server"

import {
  EDITABLE_PAGES,
  hasPendingDraft,
  isEditableSlug,
  type ContentPage,
} from "./content-items"

// Save a draft and publish a page (story 5.1). The action is the shape gate
// (AD-16): the draft is parsed with its kind's zod schema before it is saved,
// and every draft that would be published is parsed again before
// admin_publish_content; the RPCs enforce the admin, the object and the
// version. After a publish the page's cache tag is updated, and the business
// details also update content:global. The idempotency key comes from the
// editor (AD-5).

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
  content: unknown
}): Promise<ActionResult> {
  if (!isEditableSlug(input.slug)) return { ok: false, code: "INVALID_INPUT" }
  const { key } = EDITABLE_PAGES[input.slug]

  const client = await createClient()
  const page = await readPage(client, input.slug)
  if (!page.ok) return page
  const section = page.data.sections.find((s) => s.key === key)
  if (!section) return { ok: false, code: "NOT_FOUND" }

  const schema = schemaForKind(section.kind)
  const parsed = schema?.safeParse(input.content)
  if (!parsed?.success) {
    const field = parsed?.error.issues[0]?.path[0]
    return typeof field === "string"
      ? { ok: false, code: "INVALID_INPUT", detail: { field } }
      : { ok: false, code: "INVALID_INPUT" }
  }

  // JSON drops the optional fields that were left empty (undefined).
  const content = JSON.parse(JSON.stringify(parsed.data))
  const saved = await callRpc(client, "admin_set_content_draft", {
    p_slug: input.slug,
    p_key: key,
    p_content: content,
  })
  if (!saved.ok) return saved
  return { ok: true, data: undefined }
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
    const schema = schemaForKind(section.kind)
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

  updateTag(`content:${input.slug}`)
  if (input.slug === "contact") updateTag("content:global")

  return {
    ok: true,
    data: {
      publishedVersion: published.published_version,
      changed: published.changed,
    },
  }
}
