import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import { PromoBanner } from "./promo-banner"

describe("PromoBanner", () => {
  it("breaks a long word inside the ribbon", () => {
    const word = "א".repeat(60)
    const html = renderToStaticMarkup(<PromoBanner content={{ text: word }} />)
    expect(html).toContain(word)
    expect(html).toContain("[overflow-wrap:anywhere]")
  })

  it("no text: nothing", () => {
    expect(renderToStaticMarkup(<PromoBanner content={{ text: "  " }} />)).toBe(
      ""
    )
  })
})
