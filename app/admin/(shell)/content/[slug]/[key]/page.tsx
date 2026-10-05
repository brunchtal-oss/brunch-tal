import { Suspense } from "react"
import type { Metadata } from "next"
import { notFound } from "next/navigation"

import { PageHeading } from "@/components/shared/page-heading"
import { adminCopy } from "@/lib/copy/admin"
import { shellCopy } from "@/lib/copy/shell"

import { isEditorPageId, sectionRefOf } from "../../content-items"
import { EditorContent } from "../../editor-page"

const copy = adminCopy.content

export const metadata: Metadata = {
  title: copy.title,
}

// /admin/content/<page>/<key> (stories 5.1, 5.3): the editor of one
// section. Draft -> preview (the page's preview) -> publish. An unknown page
// or key is notFound().
export default function ContentSectionPage({
  params,
}: {
  params: Promise<{ slug: string; key: string }>
}) {
  return (
    <Suspense
      fallback={<p className="text-muted-foreground">{shellCopy.loading}</p>}
    >
      <Section params={params} />
    </Suspense>
  )
}

async function Section({
  params,
}: {
  params: Promise<{ slug: string; key: string }>
}) {
  const { slug, key } = await params
  if (!isEditorPageId(slug)) notFound()
  const ref = sectionRefOf(slug, key)
  if (!ref) notFound()

  return (
    <>
      <div className="flex flex-col gap-1">
        <p className="text-[13px] text-muted-foreground">{copy.pages[slug]}</p>
        <PageHeading>{copy.sections[`${ref.slug}/${ref.key}`]}</PageHeading>
      </div>
      <EditorContent pageId={slug} sectionRef={ref} />
    </>
  )
}
