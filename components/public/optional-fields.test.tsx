import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import { footerLinks, visibleSection } from "@/lib/content/visible"

import {
  FaqSection,
  StepsSection,
  TestimonialsSection,
  TextBlockSection,
} from "./sections"

// User decision 2026-10-08: no editor field is required but three, so the
// site never shows an empty heading or element.
describe("optional content fields on the site", () => {
  it("a text block without a title: no h2, no name from an empty heading", () => {
    const html = renderToStaticMarkup(
      <TextBlockSection content={{ body: "Only the text" }} />
    )
    expect(html).not.toContain("<h2")
    expect(html).not.toContain("aria-labelledby")
    expect(html).toContain("Only the text")
  })

  it("a step and a FAQ entry show only what they have", () => {
    const steps = renderToStaticMarkup(
      <StepsSection content={{ items: [{ body: "b" }] }} label="steps" />
    )
    expect(steps).not.toContain("<h3")
    expect(steps).toContain(">b<")
    const faq = renderToStaticMarkup(
      <FaqSection
        content={{ items: [{ answer: "a" }, { question: "q", answer: "x" }] }}
        label="faq"
      />
    )
    // Without a question there is nothing to open.
    expect(faq.match(/<details/g)).toHaveLength(1)
    expect(faq).toContain(">a<")
  })

  it("a text testimonial without a name has no empty caption", () => {
    const html = renderToStaticMarkup(
      <TestimonialsSection
        content={{ items: [{ kind: "text", text: "t" }] }}
        label="testimonials"
      />
    )
    expect(html).toContain("t</blockquote>")
    expect(html).not.toContain("<figcaption")
  })

  it("leaves out an empty item and an empty block", () => {
    expect(
      visibleSection({
        kind: "faq",
        content: { items: [{}, { question: "q" }] },
      })
    ).toEqual({ kind: "faq", content: { items: [{ question: "q" }] } })
    expect(
      visibleSection({ kind: "steps", content: { items: [{}] } })
    ).toBeNull()
    expect(visibleSection({ kind: "text_block", content: {} })).toBeNull()
    expect(visibleSection({ kind: "legal_text", content: {} })).toBeNull()
    expect(
      visibleSection({ kind: "text_block", content: { eyebrow: "e" } })
    ).not.toBeNull()
  })

  it("shows a footer link only with both its name and address", () => {
    expect(
      footerLinks([
        { label: "IG", url: "https://ig.example" },
        { label: "no address" },
        { url: "https://x.example" },
        {},
      ])
    ).toEqual([{ label: "IG", url: "https://ig.example" }])
    expect(footerLinks(undefined)).toEqual([])
  })
})
