import { randomUUID } from "node:crypto"

import {
  getBusinessDetails,
  guestWhatsappHref,
} from "@/lib/content/business-details"
import { schemaForSection } from "@/lib/content/schema"
import { adminCopy } from "@/lib/copy/admin"
import { signedDraftUrls } from "@/lib/media/drafts"
import { homeTitle } from "@/lib/seo/metadata"
import { OUTLINE_SLUGS, pageOutline, type OutlineRow } from "@/lib/seo/outline"
import {
  isSeoPageKey,
  SEO_PAGE_PATHS,
  type SeoPageKey,
} from "@/lib/seo/page-seo"
import { getSiteSeo } from "@/lib/seo/site-seo"
import { listUpcomingPublicSessions } from "@/lib/sessions/public"
import { siteUrl } from "@/lib/site-url"
import { createClient } from "@/lib/supabase/server"

import { ContentEditor } from "./content-editor"
import {
  editorContent,
  editorPreviewHref,
  editorStatementBlock,
  hasPendingDraft,
  sectionHidden,
  sectionOf,
  sectionStatus,
  type EditableSlug,
  type EditorPageId,
  type SectionRef,
} from "./content-items"
import {
  ContentStatusChip,
  statusChips,
  statusHint,
} from "./content-status-chip"
import { loadContentPage, loadContentPages } from "./load-page"
import { SeoOutline } from "./seo-outline"
import type { SeoPreviewContext } from "./seo-preview"
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
  const chips = statusChips(status, sectionHidden(section))
  const hint = statusHint(status)
  // Story 5.4: the saved images' draft files, for the editor's previews.
  const initial = fromContent(spec, content)
  const previewUrls = await signedDraftUrls(
    await createClient(),
    stateImages(initial).map((image) => image.media_id)
  )

  return (
    <>
      {(chips.length > 0 || hint) && (
        <div className="flex flex-wrap items-center gap-3">
          {chips.map((chip) => (
            <ContentStatusChip key={chip} status={chip} />
          ))}
          {hint && <p className="text-[15px] text-muted-foreground">{hint}</p>}
        </div>
      )}
      <ContentEditor
        slug={ref.slug}
        sectionKey={ref.key}
        kind={section.kind}
        initial={initial}
        previewUrls={previewUrls}
        keep={keptFields(ref, content)}
        hasPending={pending}
        publishKey={randomUUID()}
        previewHref={editorPreviewHref(pageId, ref.key)}
        draftInvalid={draftInvalid}
        backHref={`/admin/content/${pageId}`}
        backLabel={copy.backToPage(copy.pages[pageId])}
        statementBlock={editorStatementBlock(section)}
        seo={
          ref.kind === "page_seo" && isSeoPageKey(ref.key)
            ? await seoExtras(ref.key)
            : undefined
        }
      />
    </>
  )
}

// An SEO record's extras (fix-seo-editor): the Google-style preview's
// context (the page's address, the business name, the automatic home title,
// the site description) and the outline of the page as the site shows it
// now, from its published content (the admin's read: the full copy).
async function seoExtras(
  key: SeoPageKey
): Promise<{ preview: SeoPreviewContext; outline: React.ReactNode }> {
  const slugs = OUTLINE_SLUGS[key] as readonly EditableSlug[]
  const [site, details, pages, upcoming] = await Promise.all([
    getSiteSeo(),
    getBusinessDetails(),
    loadContentPages(slugs),
    key === "home" || key === "sessions"
      ? hasUpcomingSessions()
      : Promise.resolve(false),
  ])
  const rows: Record<string, OutlineRow[]> = {}
  for (const slug of slugs) {
    const page = pages[slug]
    if (!page?.published_at) continue
    rows[slug] = page.sections.flatMap((section) =>
      section.published_content && !section.hidden
        ? [
            {
              key: section.key,
              kind: section.kind,
              content: section.published_content,
            },
          ]
        : []
    )
  }
  const outline = pageOutline(key, {
    pages: rows,
    whatsapp: guestWhatsappHref(details) !== null,
    upcomingSessions: upcoming,
  })
  return {
    preview: {
      url: `${siteUrl()}${SEO_PAGE_PATHS[key]}`,
      siteName: site.name,
      homeTitle: key === "home" ? homeTitle(site.name, site.heroTitle) : null,
      siteDescription: site.description,
    },
    outline: <SeoOutline entries={outline} />,
  }
}

// Whether the home page shows its upcoming sessions now (a failed read: no).
async function hasUpcomingSessions(): Promise<boolean> {
  try {
    return (await listUpcomingPublicSessions(1)).length > 0
  } catch {
    return false
  }
}
