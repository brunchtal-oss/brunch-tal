import { cacheLife, cacheTag } from "next/cache"

import { marketingTagsView, type MarketingTagsView } from "@/lib/marketing-tags"
import { createPublicClient } from "@/lib/supabase/public"

// The tag the admin's save updates (app/admin/(shell)/marketing/actions.ts).
export const MARKETING_TAGS_CACHE_TAG = "marketing-tags"

// The marketing tags for the public layout (story 5.24): cached, read with
// the anon client (which sees the three ID columns only). A failed read
// (logged) or an invalid stored value turns that tool off; the page never
// breaks.
export async function getMarketingTags(): Promise<MarketingTagsView> {
  "use cache"
  cacheTag(MARKETING_TAGS_CACHE_TAG)
  cacheLife("minutes")

  try {
    const { data, error } = await createPublicClient()
      .from("marketing_tags")
      .select("ga4_measurement_id, gtm_container_id, meta_pixel_id")
      .maybeSingle()
    if (error) throw error
    return marketingTagsView(data)
  } catch {
    console.error("marketing_tags.read_failed")
    return marketingTagsView(null)
  }
}
