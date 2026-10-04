import { cacheLife, cacheTag } from "next/cache"

import { createPublicClient } from "@/lib/supabase/public"

import { businessDetailsSchema, type BusinessDetailsContent } from "./schema"
import { whatsappHref } from "./whatsapp"

// The published business details (contact › business_details, AD-16), all
// fields: cached, read with the anon client, tagged content:global (they are
// used across the site; publishing the contact page updates the tag). null
// when nothing valid is published, or when the read failed (logged): the
// site then shows the wordmark and no WhatsApp link, and keeps working.
export async function getBusinessDetails(): Promise<BusinessDetailsContent | null> {
  "use cache"
  cacheTag("content:global")
  cacheLife("minutes")

  const { data, error } = await createPublicClient()
    .from("content_sections")
    .select("published_content")
    .eq("page_slug", "contact")
    .eq("key", "business_details")
    .maybeSingle()
  if (error) {
    console.error("content.read_failed", { page: "contact" })
    return null
  }

  const parsed = businessDetailsSchema.safeParse(data?.published_content)
  return parsed.success ? parsed.data : null
}

// The WhatsApp link of the published business details, without the
// prepared message (the join and customer screens). null when nothing valid
// is published or the number cannot be read; the screens then show plain
// text.
export async function getWhatsappHref(): Promise<string | null> {
  const details = await getBusinessDetails()
  return details ? whatsappHref(details.whatsapp_phone) : null
}

// The guest's WhatsApp link: the number with the prepared message (the
// whatsapp-bar, the contact page and the home page).
export function guestWhatsappHref(
  details: BusinessDetailsContent | null
): string | null {
  return details
    ? whatsappHref(details.whatsapp_phone, details.whatsapp_message)
    : null
}
