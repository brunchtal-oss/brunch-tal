import { readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"

import { toSections } from "@/lib/content/pages"
import { shellCopy } from "@/lib/copy/shell"

import { GalleryView, HomeView, HowItWorksView } from "./page-views"

vi.mock("next/cache", () => ({ cacheLife: vi.fn(), cacheTag: vi.fn() }))
vi.mock("@/lib/supabase/public", () => ({ createPublicClient: vi.fn() }))

const WA = "https://wa.me/972544256456"

const gallery = (content: unknown) =>
  toSections([{ key: "testimonials", kind: "testimonials", content }])

describe("page views", () => {
  it("shows a published testimonial and leaves a hidden one out", () => {
    const sections = gallery({
      items: [
        { name: "shown-name", text: "shown-text" },
        { name: "hidden-name", text: "hidden-text", hidden: true },
      ],
    })
    for (const html of [
      renderToStaticMarkup(
        <GalleryView sections={sections} whatsappHref={WA} />
      ),
      renderToStaticMarkup(
        <HomeView
          home={{}}
          about={{}}
          gallery={sections}
          name="n"
          whatsappHref={WA}
        />
      ),
    ]) {
      expect(html).toContain("shown-text")
      expect(html).not.toContain("hidden-text")
      expect(html).not.toContain("hidden-name")
    }
  })

  it("shows the empty page when every testimonial is hidden", () => {
    const html = renderToStaticMarkup(
      <GalleryView
        sections={gallery({ items: [{ name: "a", text: "b", hidden: true }] })}
        whatsappHref={WA}
      />
    )
    expect(html).toContain(shellCopy.public.emptyPage)
    expect(html).not.toContain("<blockquote")
  })

  it("leaves a hidden section of the home page out", () => {
    const about = toSections([
      {
        key: "main",
        kind: "text_block",
        content: { title: "about-title", body: "b", hidden: true },
      },
    ])
    const html = renderToStaticMarkup(
      <HomeView
        home={{}}
        about={about}
        gallery={{}}
        name="n"
        whatsappHref={WA}
      />
    )
    expect(html).not.toContain("about-title")
  })

  // Fix 15: the promo banner, right under the hero and before the intro.
  const home = (banner: Record<string, unknown>) =>
    toSections([
      { key: "hero", kind: "hero", content: { title: "hero-title" } },
      { key: "promo_banner", kind: "promo_banner", content: banner },
      { key: "intro", kind: "text_block", content: { title: "intro-title" } },
    ])
  const homeHtml = (banner: Record<string, unknown>) =>
    renderToStaticMarkup(
      <HomeView
        home={home(banner)}
        about={{}}
        gallery={{}}
        name="n"
        whatsappHref={WA}
      />
    )

  it("shows the promo banner between the hero and the intro", () => {
    const html = homeHtml({ text: "בקרוב בראנצ׳ים 60+" })
    const banner = html.indexOf("בקרוב בראנצ׳ים 60+")
    expect(banner).toBeGreaterThan(html.indexOf("hero-title"))
    expect(banner).toBeLessThan(html.indexOf("intro-title"))
    expect(html).toContain("bg-primary")
    expect(html).toContain("text-primary-foreground")
    expect(html).toContain("border-dashed")
  })

  it.each([
    ["switched off", { text: "בקרוב בראנצ׳ים 60+", hidden: true }],
    ["blank", { text: "  " }],
  ])("shows no promo banner when it is %s", (_label, banner) => {
    const html = homeHtml(banner)
    expect(html).not.toContain("promo-banner")
    expect(html).not.toContain("בקרוב בראנצ׳ים 60+")
    expect(html).toContain("intro-title")
  })

  it("shows the text as text, not as HTML", () => {
    const sections = toSections([
      {
        key: "faq",
        kind: "faq",
        content: {
          items: [{ question: "<b>q</b>", answer: "<script>x</script>" }],
        },
      },
    ])
    const html = renderToStaticMarkup(
      <HowItWorksView sections={sections} whatsappHref={WA} />
    )
    expect(html).toContain("&lt;b&gt;q&lt;/b&gt;")
    expect(html).not.toContain("<script>")
  })
})

// The public pages render content as text only (the XSS filter, story 5.3).
describe("public code", () => {
  function files(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const path = join(dir, name)
      return statSync(path).isDirectory() ? files(path) : [path]
    })
  }

  it("never sets inner HTML", () => {
    const sources = [...files("components/public"), ...files("app/(public)")]
      .filter((path) => /\.tsx?$/.test(path) && !path.includes(".test."))
      .map((path) => readFileSync(path, "utf8"))
    expect(sources.length).toBeGreaterThan(5)
    for (const source of sources) {
      expect(source).not.toContain("dangerouslySetInnerHTML")
    }
  })
})
