import { Suspense } from "react"
import type { Metadata } from "next"

import { PageHeading } from "@/components/shared/page-heading"
import { adminCopy } from "@/lib/copy/admin"
import { shellCopy } from "@/lib/copy/shell"
import { createClient } from "@/lib/supabase/server"

import { MarketingIntro, MarketingTagsEditor } from "./marketing-tags-editor"

const copy = adminCopy.marketingTags

export const metadata: Metadata = {
  title: copy.title,
}

// The marketing tool IDs (story 5.24), from "more": what the screen is for,
// the privacy notice with its link, then the three IDs. Rendered inside the
// admin shell's <Suspense> gate; marketing_tags is read with the admin's
// RLS.
export default function MarketingPage() {
  return (
    <>
      <PageHeading>{copy.title}</PageHeading>
      <MarketingIntro />
      <Suspense
        fallback={<p className="text-muted-foreground">{shellCopy.loading}</p>}
      >
        <MarketingContent />
      </Suspense>
    </>
  )
}

async function MarketingContent() {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from("marketing_tags")
    .select("ga4_measurement_id, gtm_container_id, meta_pixel_id, version")
    .single()
  if (error) throw new Error("marketing tags read failed")
  return <MarketingTagsEditor row={data} />
}
