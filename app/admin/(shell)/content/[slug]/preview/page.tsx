import { randomUUID } from "node:crypto"
import { Suspense } from "react"
import type { Metadata } from "next"
import { notFound } from "next/navigation"

import {
  ContactView,
  GalleryView,
  HomeView,
  HowItWorksView,
} from "@/components/public/page-views"
import { SiteFooter } from "@/components/public/site-footer"
import { UpcomingSessions } from "@/components/public/upcoming-sessions"
import { PageHeading } from "@/components/shared/page-heading"
import { PhotoConsentFieldset } from "@/components/shared/photo-consent-fieldset"
import {
  getBusinessDetails,
  guestWhatsappHref,
} from "@/lib/content/business-details"
import {
  getPublishedPageSlugs,
  getPublishedSections,
  sectionContent,
  toSections,
  type PublishedSections,
} from "@/lib/content/pages"
import { adminCopy } from "@/lib/copy/admin"
import { joinCopy } from "@/lib/copy/join"
import { shellCopy } from "@/lib/copy/shell"
import { publicLegalNav } from "@/lib/nav"

import {
  hasPendingDraft,
  isEditorPageId,
  sectionRefOf,
  slugsOf,
  type ContentPage,
  type EditorPageId,
} from "../../content-items"
import { loadContentPages } from "../../load-page"
import { PreviewBar } from "../../preview-bar"

export const metadata: Metadata = {
  title: adminCopy.content.previewTitle,
}

// /admin/content/<page>/preview (stories 5.1, 5.3): the public page, through
// the same view component the site renders, with the saved drafts of the
// page's slugs (else what is published) and the same visibility rules
// (hidden sections and items are not shown), under the fixed bar "preview,
// not published yet". The home page shows the drafts of home and about.
// Dynamic, admin only, never cached (AD-16): the drafts are read with the
// admin's session. ?section=<key> leads "back to editing" to that section.
export default function ContentPreviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>
  searchParams: Promise<{ section?: string | string[] }>
}) {
  return (
    <Suspense
      fallback={<p className="text-muted-foreground">{shellCopy.loading}</p>}
    >
      <Preview params={params} searchParams={searchParams} />
    </Suspense>
  )
}

// What the preview shows of a page: each section's pending draft, else what
// is published.
function previewSections(page: ContentPage): PublishedSections {
  return toSections(
    page.sections.map((section) => ({
      key: section.key,
      kind: section.kind,
      content: hasPendingDraft(section)
        ? section.draft_content
        : section.published_content,
    }))
  )
}

async function Preview({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>
  searchParams: Promise<{ section?: string | string[] }>
}) {
  const [{ slug }, { section }] = await Promise.all([params, searchParams])
  if (!isEditorPageId(slug)) notFound()
  const id: EditorPageId = slug
  const pages = await loadContentPages(slugsOf(id))

  const pending = slugsOf(id)
    .filter((item) => pages[item].sections.some(hasPendingDraft))
    .map((item) => ({ slug: item, publishKey: randomUUID() }))
  const back =
    typeof section === "string" && sectionRefOf(id, section)
      ? `/admin/content/${id}/${section}`
      : `/admin/content/${id}`

  return (
    <div className="flex min-h-[70svh] flex-col">
      <PreviewBar backHref={back} pending={pending} />
      <div className="-mx-6 flex flex-1 flex-col border-b border-border pb-12">
        <PageView id={id} pages={pages} />
      </div>
    </div>
  )
}

async function PageView({
  id,
  pages,
}: {
  id: EditorPageId
  pages: Record<string, ContentPage>
}) {
  const details = await getBusinessDetails()
  const whatsappHref = guestWhatsappHref(details)

  switch (id) {
    case "home":
      return (
        <HomeView
          home={previewSections(pages.home)}
          about={previewSections(pages.about)}
          gallery={await getPublishedSections("gallery")}
          name={details?.business_name ?? shellCopy.wordmark}
          whatsappHref={whatsappHref}
          sessions={
            <Suspense fallback={null}>
              <UpcomingSessions />
            </Suspense>
          }
        />
      )
    case "how-it-works":
      return (
        <HowItWorksView
          sections={previewSections(pages["how-it-works"])}
          whatsappHref={whatsappHref}
        />
      )
    case "gallery":
      return (
        <GalleryView
          sections={previewSections(pages.gallery)}
          whatsappHref={whatsappHref}
        />
      )
    case "contact": {
      const sections = previewSections(pages.contact)
      return (
        <ContactView
          sections={sections}
          details={sectionContent(
            sections,
            "business_details",
            "business_details"
          )}
        />
      )
    }
    case "join-form": {
      const consent = sectionContent(
        previewSections(pages["join-form"]),
        "photo_consent",
        "photo_consent"
      )
      return (
        <div className="mx-auto flex w-full max-w-[480px] flex-col gap-6 px-6 pt-10">
          <PageHeading>{joinCopy.title}</PageHeading>
          {consent && <PhotoConsentFieldset content={consent} />}
        </div>
      )
    }
    case "site": {
      const legalSlugs = await getPublishedPageSlugs(
        publicLegalNav.map((item) => item.slug)
      )
      return (
        <div className="flex flex-1 flex-col justify-end">
          <SiteFooter
            details={details}
            legal={publicLegalNav.filter((item) =>
              legalSlugs.includes(item.slug)
            )}
            links={
              sectionContent(previewSections(pages.site), "footer", "footer")
                ?.items ?? []
            }
          />
        </div>
      )
    }
  }
}
