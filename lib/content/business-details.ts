import { cacheLife, cacheTag } from "next/cache"

import { createPublicClient } from "@/lib/supabase/public"

import { businessDetailsSchema } from "./schema"
import { whatsappHref } from "./whatsapp"

// The WhatsApp link of the published business details (contact ›
// business_details, AD-16): cached, read with the anon client, tagged
// content:global (the business details are used across the site; publishing
// the contact page updates the tag). null when nothing valid is published or
// the number cannot be read; the screens then show plain text.
export async function getWhatsappHref(): Promise<string | null> {
  "use cache"
  cacheTag("content:global")
  cacheLife("minutes")

  const { data, error } = await createPublicClient()
    .from("content_sections")
    .select("published_content")
    .eq("page_slug", "contact")
    .eq("key", "business_details")
    .maybeSingle()
  if (error) throw new Error("business details content failed")

  const parsed = businessDetailsSchema.safeParse(data?.published_content)
  return parsed.success ? whatsappHref(parsed.data.whatsapp_phone) : null
}
