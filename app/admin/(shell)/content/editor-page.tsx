import { randomUUID } from "node:crypto"

import { schemaForSection } from "@/lib/content/schema"
import { adminCopy } from "@/lib/copy/admin"
import { signedDraftUrls } from "@/lib/media/drafts"
import { createClient } from "@/lib/supabase/server"

import { ContentEditor } from "./content-editor"
import {
  editorContent,
  hasPendingDraft,
  sectionHidden,
  sectionOf,
  sectionStatus,
  type EditorPageId,
  type SectionRef,
} from "./content-items"
import { ContentStatusChip, statusHint } from "./content-status-chip"
import { loadContentPage } from "./load-page"
import {
  fromContent,
  keptFields,
  sectionSpec,
  stateImages,
} from "./section-fields"

const copy = adminCopy.content

// The data part of a section's editor (inside the page's <Suspense>): reads
// the section's page with the admin's session and hands the editor the
// section's content as its form state, with a fresh publish key (AD-5).
export async function EditorContent({
  pageId,
  sectionRef: ref,
}: {
  pageId: EditorPageId
  sectionRef: SectionRef
}) {
  const page = await loadContentPage(ref.slug)
  const section = sectionOf(page, ref.key)
  if (!section)
    throw new Error(`content section ${ref.slug}/${ref.key} is missing`)

  const content = editorContent(section)
  const spec = sectionSpec(ref)
  const pending = hasPendingDraft(section)
  const draftInvalid =
    pending &&
    !schemaForSection(ref.slug, ref.key, section.kind)?.safeParse(
      section.draft_content
    ).success

  const status = sectionStatus(page, section)
  const hidden = sectionHidden(section)
  // Story 5.4: the saved images' draft files, for the editor's previews.
  const initial = fromContent(spec, content)
  const previewUrls = await signedDraftUrls(
    await createClient(),
    stateImages(initial).map((image) => image.media_id)
  )

  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <ContentStatusChip status={status} />
        {hidden && <ContentStatusChip status="hidden" />}
        <p className="text-[15px] text-muted-foreground">
          {statusHint(status)}
        </p>
      </div>
      <ContentEditor
        slug={ref.slug}
        sectionKey={ref.key}
        kind={section.kind}
        initial={initial}
        previewUrls={previewUrls}
        keep={keptFields(ref, content)}
        hasPending={pending}
        publishKey={randomUUID()}
        previewHref={`/admin/content/${pageId}/preview?section=${ref.key}`}
        draftInvalid={draftInvalid}
        backHref={`/admin/content/${pageId}`}
        backLabel={copy.backToPage(copy.pages[pageId])}
        statementBlock={
          section.kind === "accessibility_statement" &&
          !section.published_content
        }
      />
    </>
  )
}
