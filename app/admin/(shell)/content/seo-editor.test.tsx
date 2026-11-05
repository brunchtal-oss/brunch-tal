import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"

import { adminCopy } from "@/lib/copy/admin"

import { ContentEditor } from "./content-editor"
import { sectionSpec, type EditorState, type TextField } from "./section-fields"
import { SeoOutline } from "./seo-outline"
import { previewAddress, previewTitle } from "./seo-preview"

vi.mock("./actions", () => ({
  saveContentDraftAction: vi.fn(),
  publishContentAction: vi.fn(),
  discardContentDraftAction: vi.fn(),
  createMediaAction: vi.fn(),
}))
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
  usePathname: () => "/admin/content/seo/gallery",
}))

const copy = adminCopy.content
const KEY = "22222222-2222-4222-8222-222222222222"
const MEDIA = "11111111-1111-4111-8111-111111111111"

const CONTEXT = {
  url: "https://example.co.il/gallery",
  siteName: "שם העסק",
  homeTitle: null,
  siteDescription: "תיאור האתר",
}

function seoEditor(state: EditorState, kind = "page_seo") {
  return renderToStaticMarkup(
    <ContentEditor
      slug="seo"
      sectionKey="gallery"
      kind={kind}
      initial={state}
      hasPending={false}
      publishKey={KEY}
      draftInvalid={false}
      seo={{
        preview: CONTEXT,
        outline: <SeoOutline entries={[]} />,
      }}
    />
  )
}

describe("the SEO editor (fix-seo-editor)", () => {
  it("a page record's fields: H1, Google title and description with soft lengths, image", () => {
    const fields = sectionSpec({
      slug: "seo",
      key: "gallery",
      kind: "page_seo",
    }).fields
    expect(fields.map((field) => field.name)).toEqual([
      "h1",
      "title",
      "description",
      "image",
    ])
    const [, title, description] = fields as TextField[]
    expect(title.softMax).toBe(60)
    expect(description.softMax).toBe(155)
    expect(
      sectionSpec({ slug: "seo", key: "site", kind: "seo_site" }).fields.map(
        (field) => field.type
      )
    ).toEqual(["image"])
  })

  it("counts the title and warns past 60 without blocking", () => {
    const long = "א".repeat(72)
    const html = seoEditor({
      text: { h1: "גלריה", title: long, description: "" },
      images: { image: null },
      items: [],
      hidden: false,
    })
    expect(html).toContain(copy.seo.counter(72, 60))
    expect(html).toContain(copy.seo.over(60))
    expect(html).toContain(copy.seo.counter(0, 155))
    expect(html).not.toContain(copy.seo.over(155))
    expect(html).toContain(copy.saveDraft)
  })

  it("shows the Google-style preview with the automatic title and description", () => {
    const html = seoEditor({
      text: { h1: "גלריה", title: "", description: "" },
      images: { image: null },
      items: [],
      hidden: false,
    })
    expect(html).toContain(copy.seo.preview)
    expect(html).toContain("גלריה · שם העסק")
    expect(html).toContain("תיאור האתר")
    expect(html).toContain("example.co.il › gallery")
    expect(html).toContain(copy.seo.outline)
  })

  it("warns about an image without alt text, and not with one", () => {
    const state = (alt: string): EditorState => ({
      text: {},
      images: { image: { media_id: MEDIA, alt, focus_x: 50, focus_y: 50 } },
      items: [],
      hidden: false,
    })
    expect(seoEditor(state(""), "seo_site")).toContain(copy.altMissing)
    expect(seoEditor(state("שולחן ערוך"), "seo_site")).not.toContain(
      copy.altMissing
    )
  })

  it("previewTitle and previewAddress", () => {
    expect(previewTitle(CONTEXT, "גלריה", " כותרת ")).toBe("כותרת")
    expect(previewTitle(CONTEXT, "גלריה", "")).toBe("גלריה · שם העסק")
    expect(previewTitle({ ...CONTEXT, homeTitle: "שם · הירו" }, "x", "")).toBe(
      "שם · הירו"
    )
    expect(previewAddress("https://example.co.il/")).toBe("example.co.il")
    expect(previewAddress("not a url")).toBe("not a url")
  })

  it("the outline links content headings and marks fixed ones", () => {
    const html = renderToStaticMarkup(
      <SeoOutline
        entries={[
          {
            level: 2,
            text: "פתיח",
            href: "/admin/content/home/intro#field-title",
          },
          { level: 2, text: "הבראנצ׳ים הקרובים" },
          { level: 3, text: copy.seo.outlineAuto, auto: true },
        ]}
      />
    )
    expect(html).toContain('href="/admin/content/home/intro#field-title"')
    expect(html).toContain(copy.seo.outlineFixed)
    expect(html.match(new RegExp(copy.seo.outlineFixed, "g"))).toHaveLength(1)
    expect(renderToStaticMarkup(<SeoOutline entries={[]} />)).toContain(
      copy.seo.outlineEmpty
    )
  })

  it("each label ends with its professional term, small, muted, in an ltr span", () => {
    const html = seoEditor({
      text: { h1: "גלריה", title: "", description: "" },
      images: { image: null },
      items: [],
      hidden: false,
    })
    const terms = copy.seo.terms
    for (const [label, term] of [
      ["הכותרת הראשית של העמוד", terms.h1],
      ["כותרת בגוגל (לא חובה)", terms.title],
      ["תיאור בגוגל (לא חובה)", terms.description],
      ["תמונת שיתוף לעמוד (לא חובה)", terms.image],
    ]) {
      // One label element holding both, the term in its own ltr span.
      expect(html).toMatch(
        new RegExp(
          `>${label.replace(/[()]/g, "\\$&")} <span dir="ltr" class="[^"]*text-muted-foreground[^"]*">${term}</span></`
        )
      )
    }
    expect([terms.h1, terms.title, terms.description, terms.image]).toEqual([
      "H1",
      "Title tag",
      "Meta description",
      "og:image",
    ])
    const site = seoEditor(
      { text: {}, images: { image: null }, items: [], hidden: false },
      "seo_site"
    )
    expect(site).toContain(
      `תמונת שיתוף לכל האתר <span dir="ltr" class="ms-2 text-[13px] font-normal text-muted-foreground">og:image</span>`
    )
  })

  it("the editor page is named SEO, with its back link", () => {
    expect(copy.pages.seo).toBe("SEO")
    expect(copy.backToPage("SEO")).toBe("חזרה ל-SEO")
    expect(copy.backToPage("גלריה והמלצות")).toBe("חזרה לגלריה והמלצות")
  })
})
