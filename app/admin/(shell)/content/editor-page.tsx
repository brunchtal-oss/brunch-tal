import { randomUUID } from "node:crypto"

import { schemaForKind } from "@/lib/content/schema"

import { ContentEditor, type EditorField } from "./content-editor"
import {
  EDITABLE_PAGES,
  editorContent,
  hasPendingDraft,
  pageStatus,
  sectionOf,
  type EditableSlug,
} from "./content-items"
import { ContentStatusChip, statusHint } from "./content-status-chip"
import { loadContentPage } from "./load-page"

// The data part of an editor page (inside the page's <Suspense>): reads the
// page with the admin's session and hands the editor its section, as text
// fields, with a fresh publish key (AD-5).
export async function EditorContent({
  slug,
  fields,
  previewHref,
}: {
  slug: EditableSlug
  fields: readonly EditorField[]
  previewHref?: string
}) {
  const page = await loadContentPage(slug)
  const section = sectionOf(page, EDITABLE_PAGES[slug].key)
  if (!section) throw new Error(`content section of ${slug} is missing`)

  const content = editorContent(section)
  const initial = Object.fromEntries(
    fields.map((field) => {
      const value = content[field.name]
      return [field.name, typeof value === "string" ? value : ""]
    })
  )
  const pending = hasPendingDraft(section)
  const draftInvalid =
    pending &&
    !schemaForKind(section.kind)?.safeParse(section.draft_content).success

  const status = pageStatus(page)

  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <ContentStatusChip status={status} />
        <p className="text-[15px] text-muted-foreground">
          {statusHint(status)}
        </p>
      </div>
      <ContentEditor
        slug={slug}
        kind={section.kind}
        fields={fields}
        initial={initial}
        hasPending={pending}
        publishKey={randomUUID()}
        previewHref={previewHref}
        draftInvalid={draftInvalid}
      />
    </>
  )
}
