import { Suspense } from "react"
import type { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"
import { ChevronRightIcon } from "lucide-react"

import { PageHeading } from "@/components/shared/page-heading"
import { getPhotoConsentContent } from "@/lib/content/join-form"
import { customerCopy } from "@/lib/copy/customer"
import { shellCopy } from "@/lib/copy/shell"
import { createClient } from "@/lib/supabase/server"

import { PhotoConsentSection } from "../photo-consent-form"
import { ProfileToaster } from "../profile-toaster"

const copy = customerCopy.profile

export const metadata: Metadata = {
  title: copy.photoTitle,
}

// The photo consents on their own page (user decision 2026-10-08), opened
// from a row on the profile: back to the profile, the section's title as
// the h1, then the two consent questions with their saves and the note at
// the end (PhotoConsentSection, unchanged in behaviour). Only her own row
// (RLS). Without published consent wording there is nothing to answer, so
// the page does not exist (the profile shows no row then). Rendered inside
// the layout's customer gate, like the profile.
export default function PhotoConsentPage() {
  return (
    <>
      <div className="flex flex-col gap-3">
        <Link
          href="/me/profile"
          className="inline-flex min-h-11 items-center gap-1 self-start text-[15px] text-muted-foreground"
        >
          <ChevronRightIcon aria-hidden strokeWidth={1.5} className="size-4" />
          {copy.backToProfile}
        </Link>
        <PageHeading>{copy.photoTitle}</PageHeading>
      </div>
      <Suspense
        fallback={<p className="text-muted-foreground">{shellCopy.loading}</p>}
      >
        <Consents />
      </Suspense>
      <ProfileToaster />
    </>
  )
}

async function Consents() {
  const supabase = await createClient()
  const { data: claims } = await supabase.auth.getClaims()
  const userId = claims?.claims?.sub

  const [profileResult, content] = await Promise.all([
    supabase
      .from("profiles")
      .select("photo_consent, personal_photo_consent")
      .eq("id", userId ?? "")
      .maybeSingle(),
    getPhotoConsentContent(),
  ])
  if (profileResult.error || !profileResult.data) {
    throw new Error("profile read failed")
  }
  if (!content) notFound()

  return (
    <div className="pb-8">
      <PhotoConsentSection
        content={content}
        titled={false}
        consents={{
          atmosphere: profileResult.data.photo_consent,
          personal: profileResult.data.personal_photo_consent,
        }}
      />
    </div>
  )
}
