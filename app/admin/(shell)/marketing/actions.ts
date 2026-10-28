"use server"

import { updateTag } from "next/cache"

import { MARKETING_TAGS_CACHE_TAG } from "@/lib/content/marketing-tags"
import type { ActionResult } from "@/lib/errors"
import { validVersion } from "@/lib/form-values"
import {
  normalizeTagId,
  TAG_COLUMNS,
  TAG_FIELDS,
  tagProblem,
  type TagField,
} from "@/lib/marketing-tags"
import { callRpc } from "@/lib/rpc"
import { createClient } from "@/lib/supabase/server"

// The marketing tags (story 5.24). The screen sends all three IDs (the two
// it did not change as saved) with the version it read; this action checks
// the shape and each ID's format (lib/marketing-tags.ts), the RPC checks
// them again, the admin and the version (STALE_VERSION). After a save the
// public layout's cached read is refreshed (updateTag).

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
// Far longer than any valid ID; a pasted snippet of code is refused here.
const MAX_LENGTH = 64

export async function updateMarketingTagsAction(input: {
  ids: Record<TagField, string>
  expectedVersion: number
  idempotencyKey: string
}): Promise<ActionResult> {
  if (
    typeof input.ids !== "object" ||
    input.ids === null ||
    !validVersion(input.expectedVersion) ||
    !UUID.test(input.idempotencyKey)
  ) {
    return { ok: false, code: "INVALID_INPUT" }
  }
  for (const field of TAG_FIELDS) {
    const value = input.ids[field]
    if (
      typeof value !== "string" ||
      value.length > MAX_LENGTH ||
      tagProblem(field, value)
    ) {
      return {
        ok: false,
        code: "INVALID_INPUT",
        detail: { field: TAG_COLUMNS[field] },
      }
    }
  }
  // A blank ID goes as "" (the RPC turns it into null: off).
  const id = (field: TagField) => normalizeTagId(input.ids[field]) ?? ""
  const result = await callRpc(
    await createClient(),
    "admin_update_marketing_tags",
    {
      p_ga4_measurement_id: id("ga4"),
      p_gtm_container_id: id("gtm"),
      p_meta_pixel_id: id("pixel"),
      p_expected_version: input.expectedVersion,
      p_idempotency_key: input.idempotencyKey,
    }
  )
  if (!result.ok) return result
  updateTag(MARKETING_TAGS_CACHE_TAG)
  return { ok: true, data: undefined }
}
