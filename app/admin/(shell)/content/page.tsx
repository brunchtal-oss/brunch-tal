import { Suspense } from "react"
import type { Metadata } from "next"
import Link from "next/link"
import { ChevronLeftIcon } from "lucide-react"

import { PageHeading } from "@/components/shared/page-heading"
import { adminCopy } from "@/lib/copy/admin"
import { shellCopy } from "@/lib/copy/shell"

import { EDITABLE_PAGES, pageStatus, type EditableSlug } from "./content-items"
import { ContentStatusChip, statusHint } from "./content-status-chip"
import { loadContentPage } from "./load-page"

const copy = adminCopy.content

export const metadata: Metadata = {
  title: copy.title,
}

// /admin/content (story 5.1): one content-section-row per page, the whole
// row one target to its editor, with the chip of the page.
export default function ContentPage() {
  return (
    <>
      <PageHeading>{copy.title}</PageHeading>
      <Suspense
        fallback={<p className="text-muted-foreground">{shellCopy.loading}</p>}
      >
        <ContentRows />
      </Suspense>
    </>
  )
}

async function ContentRows() {
  const slugs = Object.keys(EDITABLE_PAGES) as EditableSlug[]
  const pages = await Promise.all(slugs.map(loadContentPage))

  return (
    <ul className="flex flex-col">
      {slugs.map((slug, index) => {
        const status = pageStatus(pages[index])
        return (
          <li key={slug} className="border-b border-border last:border-b-0">
            <Link
              href={`/admin/content/${slug}`}
              className="flex min-h-12 items-center gap-3 py-4"
            >
              <span className="flex min-w-0 flex-1 flex-col gap-1">
                <span className="text-base font-semibold">
                  {copy.pages[slug]}
                </span>
                <span className="text-[15px] text-muted-foreground">
                  {statusHint(status)}
                </span>
              </span>
              <ContentStatusChip status={status} />
              <ChevronLeftIcon
                aria-hidden
                strokeWidth={1.5}
                className="size-5 shrink-0 text-muted-foreground"
              />
            </Link>
          </li>
        )
      })}
    </ul>
  )
}
