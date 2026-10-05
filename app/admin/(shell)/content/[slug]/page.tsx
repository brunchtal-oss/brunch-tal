import { Suspense } from "react"
import type { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"

import { PageHeading } from "@/components/shared/page-heading"
import { buttonVariants } from "@/components/ui/button"
import { adminCopy } from "@/lib/copy/admin"
import { shellCopy } from "@/lib/copy/shell"
import { cn } from "@/lib/utils"

import {
  EDITABLE_PAGES,
  editorContent,
  isEditorPageId,
  sectionHidden,
  sectionOf,
  sectionStatus,
  sectionSummary,
  slugsOf,
  type EditorPageId,
} from "../content-items"
import { ContentRow } from "../content-row"
import { statusHint, type ChipStatus } from "../content-status-chip"
import { loadContentPages } from "../load-page"

const copy = adminCopy.content

export const metadata: Metadata = {
  title: copy.title,
}

// /admin/content/<page> (story 5.3): the sections of one editor page in the
// site's order, each a content-section-row with its chips (draft /
// published / unpublished changes, and hidden), opening its own editor.
// The footer's page also leads to the business details (its phone and
// address come from there). An unknown page is notFound().
export default function ContentSectionsPage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  return (
    <Suspense
      fallback={<p className="text-muted-foreground">{shellCopy.loading}</p>}
    >
      <Sections params={params} />
    </Suspense>
  )
}

async function Sections({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  if (!isEditorPageId(slug)) notFound()
  const id: EditorPageId = slug
  const pages = await loadContentPages(slugsOf(id))

  return (
    <>
      <PageHeading>{copy.pages[id]}</PageHeading>
      <ul className="flex flex-col">
        {EDITABLE_PAGES[id].map((ref) => {
          const page = pages[ref.slug]
          const section = sectionOf(page, ref.key)
          const status = sectionStatus(page, section)
          const chips: ChipStatus[] = sectionHidden(section)
            ? [status, "hidden"]
            : [status]
          const summary = sectionSummary(editorContent(section))
          const detail = [
            summary || statusHint(status),
            ref.slug === "gallery" ? copy.alsoOnHome : "",
          ]
            .filter(Boolean)
            .join(". ")
          return (
            <ContentRow
              key={`${ref.slug}/${ref.key}`}
              href={`/admin/content/${id}/${ref.key}`}
              title={copy.sections[`${ref.slug}/${ref.key}`]}
              detail={detail}
              chips={chips}
            />
          )
        })}
        {id === "site" && (
          <ContentRow
            href="/admin/content/contact/business_details"
            title={copy.footerDetails.title}
            detail={copy.footerDetails.detail}
          />
        )}
      </ul>
      <div className="flex flex-col gap-3">
        <Link
          href={`/admin/content/${id}/preview`}
          className={cn(
            buttonVariants({ variant: "outline", size: "lg" }),
            "h-12 self-start rounded-[4px] border-foreground bg-transparent text-base"
          )}
        >
          {copy.preview}
        </Link>
        <Link
          href="/admin/content"
          className="inline-flex min-h-11 items-center self-start text-[15px] underline underline-offset-4"
        >
          {copy.backToList}
        </Link>
      </div>
    </>
  )
}
