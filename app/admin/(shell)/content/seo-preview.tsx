import { adminCopy } from "@/lib/copy/admin"

const copy = adminCopy.content.seo

// What the preview needs besides the form (from the server): the page's
// address, the business name, the home page's automatic title (null on an
// inner page, whose automatic title is "{H1} · {name}") and the site
// description.
export type SeoPreviewContext = {
  url: string
  siteName: string
  homeTitle: string | null
  siteDescription: string | null
}

/** The title a search result shows for the form's values. */
export function previewTitle(
  context: Pick<SeoPreviewContext, "siteName" | "homeTitle">,
  h1: string,
  title: string
): string {
  const own = title.trim()
  if (own) return own
  if (context.homeTitle !== null) return context.homeTitle
  const heading = h1.trim()
  return heading ? `${heading} · ${context.siteName}` : context.siteName
}

/** "example.com › how-it-works": the address line of a search result. */
export function previewAddress(url: string): string {
  try {
    const parsed = new URL(url)
    const parts = parsed.pathname.split("/").filter(Boolean)
    return [parsed.host, ...parts].join(" › ")
  } catch {
    return url
  }
}

// A search result as Google roughly shows it (fix-seo-editor), live from the
// form: the address, the title on one line and the description on two, cut
// as Google cuts them. The one place in the editor drawn like another
// product, so it sits on the card surface with a thin border.
export function SeoPreview({
  context,
  h1,
  title,
  description,
}: {
  context: SeoPreviewContext
  h1: string
  title: string
  description: string
}) {
  const shownDescription = description.trim() || context.siteDescription
  return (
    <section aria-labelledby="seo-preview" className="flex flex-col gap-2">
      <h2 id="seo-preview" className="text-[15px] font-semibold">
        {copy.preview}
      </h2>
      <div className="flex flex-col gap-1 rounded-lg border border-border bg-card px-4 py-3.5">
        <p className="truncate text-[13px] text-muted-foreground">
          <bdi dir="ltr">{previewAddress(context.url)}</bdi>
        </p>
        <p className="line-clamp-1 font-heading text-[19px] leading-[1.3] text-primary">
          {previewTitle(context, h1, title)}
        </p>
        {shownDescription && (
          <p className="line-clamp-2 text-[15px] leading-[1.45] text-pretty">
            {shownDescription}
          </p>
        )}
      </div>
      <p className="text-[13px] text-muted-foreground">{copy.previewHint}</p>
    </section>
  )
}
