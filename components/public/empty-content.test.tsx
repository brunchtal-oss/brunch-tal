import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"

import { shellCopy } from "@/lib/copy/shell"

import {
  ContactView,
  GalleryView,
  HomeView,
  HowItWorksView,
} from "./page-views"

vi.mock("next/cache", () => ({ cacheLife: vi.fn(), cacheTag: vi.fn() }))
vi.mock("@/lib/supabase/public", () => ({ createPublicClient: vi.fn() }))

// Story 6.7, T19 (AV1): with no published content, the public pages show
// only system copy. Every marketing text and image comes from published
// content, so none is in the code. The home page holds about, the
// testimonials and contact (there is no /about route).

// Every string of the shells' microcopy, the nav labels among them.
function strings(value: unknown): string[] {
  if (typeof value === "string") return [value]
  if (value && typeof value === "object") {
    return Object.values(value).flatMap(strings)
  }
  return []
}
const SYSTEM = new Set(strings(shellCopy).map((s) => s.trim()))

// The visible text of the markup: every text node, entities decoded, plus
// every alt, title and aria-label (a screen reader reads them too).
function visibleText(html: string): string[] {
  const decode = (s: string) =>
    s
      .replace(/&quot;/g, '"')
      .replace(/&#x27;/g, "'")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&amp;/g, "&")
  const attributes = [
    ...html.matchAll(/\s(?:alt|title|aria-label)="([^"]*)"/g),
  ].map((m) => m[1])
  const text = html.replace(/<[^>]*>/g, "\n").split("\n")
  return [...attributes, ...text].map((s) => decode(s).trim()).filter(Boolean)
}

const WA = "https://wa.me/972500000000"

const views: Array<[string, () => React.ReactElement]> = [
  [
    "home (with about, testimonials and contact)",
    () => (
      <HomeView
        home={{}}
        about={{}}
        gallery={{}}
        name={shellCopy.wordmark}
        whatsappHref={WA}
      />
    ),
  ],
  ["how it works", () => <HowItWorksView sections={{}} whatsappHref={WA} />],
  ["gallery", () => <GalleryView sections={{}} whatsappHref={WA} />],
  ["contact", () => <ContactView sections={{}} details={null} />],
]

describe("the public pages with no published content", () => {
  it.each(views)("%s: only system copy is visible", (_name, view) => {
    const texts = visibleText(renderToStaticMarkup(view()))
    expect(texts.length).toBeGreaterThan(0)
    expect(texts.filter((text) => !SYSTEM.has(text))).toEqual([])
    expect(renderToStaticMarkup(view())).not.toContain("<img")
  })
})
