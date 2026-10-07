import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import type { ImageMap } from "@/lib/content/pages"
import type { TestimonialsContent } from "@/lib/content/schema"
import { shellCopy } from "@/lib/copy/shell"

import { TestimonialsSection } from "./sections"
import { MAX_DOTS, TestimonialCarousel } from "./testimonial-carousel"

const copy = shellCopy.public.carousel

const text = (n: number, hidden?: boolean) => ({
  kind: "text" as const,
  name: `name-${n}`,
  text: `text-${n}`,
  ...(hidden ? { hidden } : {}),
})

const render = (content: TestimonialsContent, images: ImageMap = {}) =>
  renderToStaticMarkup(
    <TestimonialsSection label="t" content={content} images={images} />
  )

const dots = (html: string) =>
  html.match(/aria-label="המלצה \d+ מתוך \d+"/g) ?? []

describe("TestimonialCarousel", () => {
  it("shows three items with buttons and three dots, the first current", () => {
    const html = render({ items: [text(1), text(2), text(3)] })
    expect(html.match(/<li/g)).toHaveLength(3)
    expect(html).toContain(`aria-label="${copy.previous}"`)
    expect(html).toContain(`aria-label="${copy.next}"`)
    expect(dots(html)).toEqual([
      `aria-label="${copy.item(1, 3)}"`,
      `aria-label="${copy.item(2, 3)}"`,
      `aria-label="${copy.item(3, 3)}"`,
    ])
    expect(html.match(/aria-current="true"/g)).toHaveLength(1)
    expect(html).toMatch(
      new RegExp(`aria-label="${copy.item(1, 3)}" aria-current="true"`)
    )
    // At the first item "previous" is aria-disabled and "next" is not.
    expect(html).toMatch(
      new RegExp(`aria-label="${copy.previous}" aria-disabled="true"`)
    )
    expect(html).not.toMatch(
      new RegExp(`aria-label="${copy.next}" aria-disabled`)
    )
  })

  it("leaves a hidden testimonial out of the items and the dots", () => {
    const html = render({ items: [text(1), text(2), text(3, true)] })
    expect(html.match(/<li/g)).toHaveLength(2)
    expect(dots(html)).toHaveLength(2)
    expect(html).not.toContain("text-3")
    expect(html).not.toContain("name-3")
  })

  it("leaves an image testimonial with no published file out and does not count it", () => {
    const html = render({
      items: [
        text(1),
        text(2),
        {
          kind: "image",
          image: {
            media_id: "00000000-0000-0000-0000-000000000001",
            focus_x: 50,
            focus_y: 50,
          },
        },
      ],
    })
    expect(html.match(/<li/g)).toHaveLength(2)
    expect(dots(html)).toEqual([
      `aria-label="${copy.item(1, 2)}"`,
      `aria-label="${copy.item(2, 2)}"`,
    ])
  })

  it("shows a published image testimonial whole, in the row with the text", () => {
    const id = "00000000-0000-0000-0000-000000000002"
    const html = render(
      {
        items: [
          text(1),
          {
            kind: "image",
            image: { media_id: id, focus_x: 50, focus_y: 50 },
            name: "img-name",
          },
        ],
      },
      { [id]: { src: "/x.png", alt: "alt-x", focusX: 50, focusY: 50 } }
    )
    expect(html.match(/<li/g)).toHaveLength(2)
    expect(html).toContain('alt="alt-x"')
    expect(html).toContain("object-contain")
    expect(html).toContain("h-[min(440px,55svh)]")
    expect(html).not.toContain("object-cover")
  })

  it("shows dots up to MAX_DOTS and a counter above it", () => {
    const many = (n: number) =>
      render({ items: Array.from({ length: n }, (_, i) => text(i + 1)) })
    const atLimit = many(MAX_DOTS)
    expect(dots(atLimit)).toHaveLength(MAX_DOTS)
    expect(atLimit).not.toContain("flex-wrap")
    expect(atLimit).not.toContain("aria-live")

    const above = many(MAX_DOTS + 1)
    expect(dots(above)).toHaveLength(0)
    expect(above).toMatch(
      new RegExp(`aria-live="polite"[^>]*>${copy.counter(1, MAX_DOTS + 1)}<`)
    )
    expect(above).toContain(`aria-label="${copy.previous}"`)
    expect(above).toContain(`aria-label="${copy.next}"`)
  })

  it("shows one testimonial with no buttons and no dots", () => {
    const html = render({ items: [text(1), text(2, true)] })
    expect(html.match(/<li/g)).toHaveLength(1)
    expect(html).toContain("text-1")
    expect(html).not.toContain("<button")
    expect(dots(html)).toHaveLength(0)
  })

  it("renders no section when no testimonial remains", () => {
    expect(render({ items: [text(1, true)] })).toBe("")
    expect(render({ items: [] })).toBe("")
  })

  it("names the row and keeps the items in a scroll-snap track", () => {
    const html = renderToStaticMarkup(
      <TestimonialCarousel label="row" items={["a", "b"]} />
    )
    expect(html).toMatch(/<ul[^>]*aria-label="row"/)
    expect(html).toContain("snap-x")
    expect(html).toContain("snap-mandatory")
    expect(html).toContain("snap-center")
  })
})
