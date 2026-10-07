import { Suspense } from "react"
import type { Metadata } from "next"
import Link from "next/link"
import { ChevronLeftIcon } from "lucide-react"

import { PageHeading } from "@/components/shared/page-heading"
import { getPhotoConsentContent } from "@/lib/content/join-form"
import { getPublishedPageSlugs } from "@/lib/content/pages"
import { customerCopy } from "@/lib/copy/customer"
import { shellCopy } from "@/lib/copy/shell"
import { publicLegalNav, visibleLegalNav } from "@/lib/nav"
import { formatLocalPhone } from "@/lib/phone"
import { createClient } from "@/lib/supabase/server"
import { localToday } from "@/lib/time"

import { BabiesSection } from "./babies-section"
import { DetailsSection } from "./details-section"
import { PhotoConsentSection } from "./photo-consent-form"
import { ProfileToaster } from "./profile-toaster"

export const metadata: Metadata = {
  title: shellCopy.nav.profileTitle,
}

const copy = customerCopy.profile

// The legal pages linked at the bottom of the profile (story 5.5): the
// accessibility statement always, privacy once published.
const PROFILE_LEGAL = ["privacy", "accessibility"] as const

// The customer's profile (story 2.10, CAP-8, CAP-40): her details (name and
// dietary notes to edit, phone and email to read), her babies, the photo
// consent and the links. Only her own rows (RLS); the email from the Auth
// claims. Rendered inside the layout's customer gate.
export default function ProfilePage() {
  return (
    <>
      <PageHeading>{shellCopy.nav.profileTitle}</PageHeading>
      <Suspense
        fallback={<p className="text-muted-foreground">{shellCopy.loading}</p>}
      >
        <Profile />
      </Suspense>
      <ProfileToaster />
    </>
  )
}

async function Profile() {
  const supabase = await createClient()
  const { data: claims } = await supabase.auth.getClaims()
  const userId = claims?.claims?.sub
  const email =
    typeof claims?.claims?.email === "string" ? claims.claims.email : null

  const [profileResult, babiesResult, photoContent, legalSlugs] =
    await Promise.all([
      supabase
        .from("profiles")
        .select(
          "full_name, dietary_notes, phone_e164, photo_consent, personal_photo_consent"
        )
        .eq("id", userId ?? "")
        .maybeSingle(),
      supabase
        .from("babies")
        .select("id, name, birth_date")
        .order("birth_date")
        .order("created_at"),
      getPhotoConsentContent(),
      getPublishedPageSlugs(publicLegalNav.map((item) => item.slug)),
    ])
  if (profileResult.error || babiesResult.error || !profileResult.data) {
    throw new Error("profile read failed")
  }
  const profile = profileResult.data
  const today = localToday()

  return (
    <>
      <DetailsSection
        fullName={profile.full_name}
        dietaryNotes={profile.dietary_notes}
        phone={profile.phone_e164 ? formatLocalPhone(profile.phone_e164) : null}
        email={email}
      />
      <BabiesSection
        babies={(babiesResult.data ?? []).map((baby) => ({
          id: baby.id,
          name: baby.name,
          birthDate: baby.birth_date,
        }))}
        today={today}
      />
      {photoContent && (
        <PhotoConsentSection
          content={photoContent}
          consents={{
            atmosphere: profile.photo_consent,
            personal: profile.personal_photo_consent,
          }}
        />
      )}
      <nav aria-label={copy.linksLabel}>
        <ul className="flex flex-col divide-y divide-border border-y border-border">
          {[
            { href: "/install", label: copy.installGuide },
            ...visibleLegalNav(legalSlugs, PROFILE_LEGAL),
          ].map((item) => (
            <li key={item.href}>
              <Link
                href={item.href}
                className="flex min-h-12 items-center justify-between gap-3 py-3 text-base"
              >
                {item.label}
                <ChevronLeftIcon
                  aria-hidden
                  strokeWidth={1.5}
                  className="size-5 text-muted-foreground"
                />
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </>
  )
}
