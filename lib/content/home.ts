import { cacheLife, cacheTag } from "next/cache"

import { createPublicClient } from "@/lib/supabase/public"

import { heroSchema, type HeroContent } from "./schema"

// The published hero of the home page (home › hero, AD-16): cached, read
// with the anon client (published rows of a published page only, RLS),
// tagged for admin_publish_content. null when nothing valid is published;
// the home page then shows the business name only.
export async function getHomeHero(): Promise<HeroContent | null> {
  "use cache"
  cacheTag("content:home")
  cacheLife("minutes")

  const { data, error } = await createPublicClient()
    .from("content_sections")
    .select("published_content")
    .eq("page_slug", "home")
    .eq("key", "hero")
    .maybeSingle()
  if (error) throw new Error("home hero content failed")

  const parsed = heroSchema.safeParse(data?.published_content)
  return parsed.success ? parsed.data : null
}
