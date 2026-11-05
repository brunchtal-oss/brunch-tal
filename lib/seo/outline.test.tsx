import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"

import {
  AccessibilityView,
  LegalTextView,
} from "@/components/public/legal-views"
import {
  ContactView,
  GalleryView,
  HomeView,
  HowItWorksView,
} from "@/components/public/page-views"
import { PublicPageHeading } from "@/components/public/public-page"
import { PublicSessionList } from "@/components/public/public-sessions"
import { UpcomingSessionsSection } from "@/components/public/upcoming-sessions"
import {
  EDITABLE_PAGES,
  isEditorPageId,
  sectionRefOf,
} from "@/app/admin/(shell)/content/content-items"
import {
  fieldId,
  sectionSpec,
} from "@/app/admin/(shell)/content/section-fields"
import { sectionContent, toSections } from "@/lib/content/pages"
import { shellCopy } from "@/lib/copy/shell"
import type { PublicSession } from "@/lib/sessions/public"

import {
  pageOutline,
  type OutlineEntry,
  type OutlineInput,
  type OutlineRow,
} from "./outline"

vi.mock("next/cache", () => ({ cacheLife: vi.fn(), cacheTag: vi.fn() }))
vi.mock("@/lib/supabase/public", () => ({ createPublicClient: vi.fn() }))
vi.mock("server-only", () => ({}))

const WA = "https://wa.me/972544256456"

// The fixtures: every heading kind, with hidden and empty ones that the site
// leaves out.
const ROWS: Record<string, OutlineRow[]> = {
  home: [
    { key: "hero", kind: "hero", content: { title: "hero-title" } },
    {
      key: "intro",
      kind: "text_block",
      content: { title: "intro-h2", body: "b" },
    },
    {
      key: "contact",
      kind: "text_block",
      content: { title: "contact-h2", body: "b" },
    },
  ],
  about: [
    {
      key: "main",
      kind: "text_block",
      content: { title: "about-h2", body: "b" },
    },
  ],
  gallery: [
    {
      key: "testimonials",
      kind: "testimonials",
      content: { title: "testimonials-h2", items: [{ name: "n", text: "t" }] },
    },
    {
      key: "photos",
      kind: "gallery",
      content: { items: [] },
    },
  ],
  "how-it-works": [
    {
      key: "steps",
      kind: "steps",
      content: {
        items: [
          { title: "step-hidden", hidden: true },
          { title: "step-1", body: "b" },
          { body: "no-title" },
          { title: "step-3" },
        ],
      },
    },
    {
      key: "faq",
      kind: "faq",
      content: { title: "faq-h2", items: [{ question: "q", answer: "a" }] },
    },
  ],
  contact: [
    { key: "intro", kind: "text_block", content: { title: "", body: "body" } },
  ],
  privacy: [
    {
      key: "body",
      kind: "legal_text",
      content: { body: "## first **bold**\n\ntext\n\n## second\n\nmore" },
    },
  ],
  terms: [{ key: "body", kind: "legal_text", content: { body: "plain" } }],
  accessibility: [
    {
      key: "statement",
      kind: "accessibility_statement",
      content: {
        body: "intro\n\n## a11y-h2",
        contact_name: "x",
        contact_phone: "0544256456",
        contact_email: "a@b.co",
      },
    },
  ],
}

const INPUT: OutlineInput = {
  pages: ROWS,
  whatsapp: true,
  upcomingSessions: true,
}

const sections = (slug: string) => toSections(ROWS[slug])

const session = (id: string): PublicSession => ({
  id,
  starts_at: "2026-12-01T08:00:00Z",
  description: null,
  display_price_agorot: null,
  concept_name: `concept-${id}`,
  photo: null,
})

// The H2 and H3 of a rendered page, in order, as text.
function renderedHeadings(html: string): { level: 2 | 3; text: string }[] {
  return [...html.matchAll(/<h([23])\b[^>]*>([\s\S]*?)<\/h\1>/g)].map(
    (match) => ({
      level: Number(match[1]) as 2 | 3,
      text: match[2].replace(/<[^>]+>/g, "").trim(),
    })
  )
}

// The outline equals the headings; an automatic entry stands for one or
// more headings of its level.
function matches(
  outline: OutlineEntry[],
  rendered: { level: 2 | 3; text: string }[]
) {
  let i = 0
  for (const entry of outline) {
    if (entry.auto) {
      expect(rendered[i]?.level).toBe(entry.level)
      while (
        i < rendered.length &&
        rendered[i].level === entry.level &&
        rendered[i].text.includes("concept-")
      ) {
        i += 1
      }
      continue
    }
    expect(rendered[i]).toEqual({ level: entry.level, text: entry.text })
    i += 1
  }
  expect(i).toBe(rendered.length)
}

const PAGES: Record<string, () => string> = {
  home: () =>
    renderToStaticMarkup(
      <HomeView
        home={sections("home")}
        about={sections("about")}
        gallery={sections("gallery")}
        name="biz"
        whatsappHref={WA}
        sessions={
          <UpcomingSessionsSection sessions={[session("a"), session("b")]} />
        }
      />
    ),
  sessions: () =>
    renderToStaticMarkup(
      <>
        <PublicPageHeading>h1</PublicPageHeading>
        <PublicSessionList
          sessions={[session("a"), session("b")]}
          whatsappHref={WA}
        />
      </>
    ),
  how_it_works: () =>
    renderToStaticMarkup(
      <HowItWorksView sections={sections("how-it-works")} whatsappHref={WA} />
    ),
  gallery: () =>
    renderToStaticMarkup(
      <GalleryView sections={sections("gallery")} whatsappHref={WA} />
    ),
  contact: () =>
    renderToStaticMarkup(
      <ContactView sections={sections("contact")} details={null} />
    ),
  privacy: () =>
    renderToStaticMarkup(
      <LegalTextView
        title="h1"
        content={sectionContent(sections("privacy"), "body", "legal_text")}
        publishedAt={null}
        whatsappHref={null}
      />
    ),
  terms: () =>
    renderToStaticMarkup(
      <LegalTextView
        title="h1"
        content={sectionContent(sections("terms"), "body", "legal_text")}
        publishedAt={null}
        whatsappHref={null}
      />
    ),
  accessibility: () =>
    renderToStaticMarkup(
      <AccessibilityView
        content={sectionContent(
          sections("accessibility"),
          "statement",
          "accessibility_statement"
        )}
        publishedAt={null}
        details={null}
      />
    ),
}

describe("pageOutline", () => {
  it.each(Object.keys(PAGES))(
    "equals the headings the site renders: %s",
    (page) => {
      const outline = pageOutline(page as never, INPUT)
      matches(outline, renderedHeadings(PAGES[page]()))
    }
  )

  it("links content headings to their field and leaves microcopy unlinked", () => {
    const steps = pageOutline("how_it_works", INPUT)
    expect(steps[0]).toEqual({
      level: 2,
      text: shellCopy.public.sections.steps,
    })
    // The editor's index of the item, counting the hidden one before it.
    expect(steps[1]).toMatchObject({
      text: "step-1",
      href: "/admin/content/how-it-works/steps#field-items-1-title",
    })
    expect(steps[2].href).toBe(
      "/admin/content/how-it-works/steps#field-items-3-title"
    )
    const home = pageOutline("home", INPUT)
    expect(home[0].href).toBe("/admin/content/home/intro#field-title")
    expect(home[1]).toEqual({
      level: 2,
      text: shellCopy.public.sessions.upcoming,
    })
    expect(pageOutline("privacy", INPUT)[0]).toEqual({
      level: 2,
      text: "first bold",
      href: "/admin/content/privacy/body#field-body",
    })
  })

  it("leaves out home › contact without WhatsApp and the sessions without any", () => {
    const home = pageOutline("home", {
      ...INPUT,
      whatsapp: false,
      upcomingSessions: false,
    })
    expect(home.map((entry) => entry.text)).toEqual([
      "intro-h2",
      "about-h2",
      "testimonials-h2",
    ])
    expect(
      pageOutline("sessions", { ...INPUT, upcomingSessions: false })
    ).toEqual([])
    // Without sessions /sessions shows a line of text, no heading.
    const empty = renderToStaticMarkup(
      <PublicSessionList sessions={[]} whatsappHref={WA} />
    )
    expect(renderedHeadings(empty)).toEqual([])
  })

  it("leaves out a hidden section", () => {
    const pages = {
      ...ROWS,
      about: [
        {
          key: "main",
          kind: "text_block",
          content: { title: "about-h2", body: "b", hidden: true },
        },
      ],
    }
    const home = pageOutline("home", { ...INPUT, pages })
    expect(home.map((entry) => entry.text)).not.toContain("about-h2")
  })

  it("links every content heading to a field its section's editor renders", () => {
    const pages = [
      "home",
      "sessions",
      "how_it_works",
      "gallery",
      "contact",
      "privacy",
      "terms",
      "accessibility",
    ] as const
    const hrefs = pages.flatMap((page) =>
      pageOutline(page, INPUT).flatMap((entry) =>
        entry.href ? [entry.href] : []
      )
    )
    // The fixtures cover every kind of edit link.
    expect(hrefs).toEqual(
      expect.arrayContaining([
        "/admin/content/home/intro#field-title",
        "/admin/content/home/main#field-title",
        "/admin/content/gallery/testimonials#field-title",
        "/admin/content/home/contact#field-title",
        "/admin/content/how-it-works/steps#field-items-1-title",
        "/admin/content/how-it-works/faq#field-title",
        "/admin/content/privacy/body#field-body",
        "/admin/content/accessibility/statement#field-body",
      ])
    )
    for (const href of hrefs) {
      const match = /^\/admin\/content\/([^/]+)\/([^/#]+)#(.+)$/.exec(href)
      expect(match, href).not.toBeNull()
      const [, page, key, fragment] = match!
      expect(isEditorPageId(page), href).toBe(true)
      const ref = sectionRefOf(page as keyof typeof EDITABLE_PAGES, key)
      expect(ref, href).not.toBeNull()
      const ids = new Set<string>()
      for (const field of sectionSpec(ref!).fields) {
        if (field.type === "list") {
          for (const sub of field.fields) {
            for (let i = 0; i < 10; i += 1) {
              ids.add(fieldId(`items.${i}.${sub.name}`))
            }
          }
        } else {
          ids.add(fieldId(field.name))
        }
      }
      expect(ids.has(fragment), href).toBe(true)
    }
  })

  it("is empty for a page that is not published", () => {
    expect(pageOutline("contact", { ...INPUT, pages: {} })).toEqual([])
    expect(pageOutline("accessibility", { ...INPUT, pages: {} })).toEqual([])
  })
})
