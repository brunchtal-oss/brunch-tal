import { cacheLife, cacheTag } from "next/cache"

import { createPublicClient } from "@/lib/supabase/public"

import { photoConsentSchema, type PhotoConsentContent } from "./schema"

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
