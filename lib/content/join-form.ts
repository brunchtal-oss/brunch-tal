import { cacheLife, cacheTag } from "next/cache"

import { SPECIAL_BRUNCH_FALLBACK } from "@/lib/special-brunch"
import { createPublicClient } from "@/lib/supabase/public"

import {
  photoConsentSchema,
  specialBrunchSchema,
  type PhotoConsentContent,
  type SpecialBrunchContent,
} from "./schema"

// The published photo consent wording of the join form (content, AD-16):
// cached, read with the anon client, tagged for admin_publish_content (E5).
// null when nothing valid is published.
export async function getPhotoConsentContent(): Promise<PhotoConsentContent | null> {
  "use cache"
  cacheTag("content:join-form")
  cacheLife("minutes")

  const { data, error } = await createPublicClient()
    .from("content_sections")
    .select("published_content")
    .eq("page_slug", "join-form")
    .eq("key", "photo_consent")
    .maybeSingle()
  if (error) throw new Error("photo consent content failed")

  const parsed = photoConsentSchema.safeParse(data?.published_content)
  return parsed.success ? parsed.data : null
}

// Story 2.16: the one reader of the special-brunch wording (the join forms,
// the profile, the customer card, the list chips and the export cells). The
// published block, or the seed's wording (SPECIAL_BRUNCH_FALLBACK) when it
// is missing or fails the schema. Never null: the question is optional, so
// no screen stops for it.
export async function getSpecialBrunchContent(): Promise<SpecialBrunchContent> {
  "use cache"
  cacheTag("content:join-form")
  cacheLife("minutes")

  const { data, error } = await createPublicClient()
    .from("content_sections")
    .select("published_content")
    .eq("page_slug", "join-form")
    .eq("key", "special_brunch")
    .maybeSingle()
  // A failed read is not cached as the fallback.
  if (error) throw new Error("special brunch content failed")

  const parsed = specialBrunchSchema.safeParse(data?.published_content)
  return parsed.success ? parsed.data : SPECIAL_BRUNCH_FALLBACK
}
