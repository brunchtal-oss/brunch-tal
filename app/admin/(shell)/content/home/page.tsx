import { Suspense } from "react"
import type { Metadata } from "next"

import { PageHeading } from "@/components/shared/page-heading"
import { adminCopy } from "@/lib/copy/admin"
import { shellCopy } from "@/lib/copy/shell"

import type { EditorField } from "../content-editor"
import { EditorContent } from "../editor-page"

const copy = adminCopy.content

export const metadata: Metadata = {
  title: copy.pages.home,
}

// The hero's fields (lib/content/schema.ts › heroSchema).
const FIELDS: readonly EditorField[] = [
  { name: "title", label: copy.hero.title, maxLength: 80 },
  {
    name: "description",
    label: copy.hero.description,
    multiline: true,
    maxLength: 300,
  },
  {
    name: "cta_label",
    label: copy.hero.ctaLabel,
    hint: copy.hero.ctaHint,
    maxLength: 40,
  },
]

// /admin/content/home (story 5.1): the hero of the home page. Draft ->
// preview -> publish.
export default function ContentHomePage() {
  return (
    <>
      <PageHeading>{copy.pages.home}</PageHeading>
      <Suspense
        fallback={<p className="text-muted-foreground">{shellCopy.loading}</p>}
      >
        <EditorContent
          slug="home"
          fields={FIELDS}
          previewHref="/admin/content/home/preview"
        />
      </Suspense>
    </>
  )
}
