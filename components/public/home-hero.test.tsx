import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import { shellCopy } from "@/lib/copy/shell"
import { hasPublicSessions } from "@/lib/nav"

import { HomeHero } from "./home-hero"

const HERO = {
  title: "hero-title",
  description: "hero-desc",
  cta_label: "hero-cta",
}

describe("HomeHero", () => {
  it("shows only the business name without a hero", () => {
    const html = renderToStaticMarkup(<HomeHero hero={null} />)
    expect(html).toContain(shellCopy.wordmark)
    expect(html.match(/<p/g)).toBeNull()
    expect(html).not.toContain("<a")
  })

  it("shows the published business name instead of the wordmark", () => {
    const html = renderToStaticMarkup(<HomeHero hero={null} name="biz-name" />)
    expect(html).toContain("biz-name")
    expect(html).not.toContain(shellCopy.wordmark)
  })

  it("shows the title and the description", () => {
    const html = renderToStaticMarkup(<HomeHero hero={HERO} />)
    expect(html).toContain(shellCopy.wordmark)
    expect(html).toContain("hero-title")
    expect(html).toContain("hero-desc")
    expect(html.match(/<p/g)).toHaveLength(2)
  })

  it("has no description element without a description", () => {
    const html = renderToStaticMarkup(
      <HomeHero hero={{ title: "hero-title", cta_label: "hero-cta" }} />
    )
    expect(html.match(/<p/g)).toHaveLength(1)
  })

  it("has no link to /sessions while the page is not in the public navigation", () => {
    expect(hasPublicSessions()).toBe(false)
    const html = renderToStaticMarkup(<HomeHero hero={HERO} />)
    expect(html).not.toContain('href="/sessions"')
    expect(html).not.toContain("hero-cta")
  })
})
