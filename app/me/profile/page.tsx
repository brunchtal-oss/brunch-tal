import { Suspense } from "react"
import type { Metadata } from "next"
import Link from "next/link"
import { ChevronLeftIcon } from "lucide-react"

import { PageHeading } from "@/components/shared/page-heading"
import { cubeTitleClass } from "@/components/shared/section-title"
import { getPhotoConsentContent } from "@/lib/content/join-form"
import { getPublishedPageSlugs } from "@/lib/content/pages"
import { customerCopy } from "@/lib/copy/customer"
import { shellCopy } from "@/lib/copy/shell"
import { publicLegalNav, visibleLegalNav } from "@/lib/nav"
import { formatLocalPhone } from "@/lib/phone"
import { createClient } from "@/lib/supabase/server"
import { localToday } from "@/lib/time"
import { cn } from "@/lib/utils"

import { BabiesSection } from "./babies-section"
import { DetailsSection } from "./details-section"
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
// consent as a row to its own page (/me/profile/photos, user decision
// 2026-10-08) and the links. Only her own rows (RLS); the email from the Auth
// claims. Rendered inside the layout's customer gate. Each part a cube
// (DESIGN › card; fix 11, user decision 2026-10-20): details, babies, the
// photos row, then the links.
export default function ProfilePage() {
  return (
    <>
      {/* No visible heading (user decision 2026-10-08); the page keeps its
          h1 for screen readers and the route focus. */}
      <PageHeading className="sr-only">
        {shellCopy.nav.profileTitle}
      </PageHeading>
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
        .select("full_name, dietary_notes, phone_e164")
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
        // A heading-size link to its own page, in the section's place (user
        // decision 2026-10-08): a cube that is one row, the title in the
        // cube title's type, a chevron at its end.
        <Link
          href="/me/profile/photos"
          className={cn(
            cubeTitleClass,
            "flex min-h-12 items-center justify-between gap-3 rounded-xl border border-border bg-card px-4 py-3 hover:bg-muted"
          )}
        >
          {copy.photoTitle}
          <ChevronLeftIcon
            aria-hidden
            strokeWidth={1.5}
            className="size-5 shrink-0 text-muted-foreground"
          />
        </Link>
      )}
      <nav
        aria-label={copy.linksLabel}
        className="rounded-xl border border-border bg-card px-4 py-1"
      >
        <ul className="flex flex-col divide-y divide-border">
          {[
            { href: "/me/notifications", label: copy.notificationsRow },
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
