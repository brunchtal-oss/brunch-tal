import { Suspense } from "react"
import type { Metadata } from "next"

import { PageHeading } from "@/components/shared/page-heading"
import { adminCopy } from "@/lib/copy/admin"
import { shellCopy } from "@/lib/copy/shell"

import {
  EDITABLE_PAGES,
  EDITABLE_SLUGS,
  EDITOR_PAGE_IDS,
  pageStatus,
  slugsOf,
} from "./content-items"
import { ContentRow } from "./content-row"
import { statusHint } from "./content-status-chip"
import { loadContentPages } from "./load-page"

const copy = adminCopy.content

export const metadata: Metadata = {
  title: copy.title,
}

// /admin/content (stories 5.1, 5.3): one content-section-row per editor
// page, grouped by where it is on the site, the whole row one target to the
// page's sections, with the chip of all its sections.
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
  const pages = await loadContentPages(EDITABLE_SLUGS)

  return (
    <ul className="flex flex-col">
      {EDITOR_PAGE_IDS.map((id) => {
        const status = pageStatus(
          slugsOf(id).map((slug) => pages[slug]),
          EDITABLE_PAGES[id]
        )
        return (
          <ContentRow
            key={id}
            href={`/admin/content/${id}`}
            title={copy.pages[id]}
            detail={statusHint(status)}
            chips={[status]}
          />
        )
      })}
    </ul>
  )
}
