import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import { TextBlockSection, lineAlignClass } from "./sections"

// The class on the rendered body paragraph.
function bodyClass(body: string): string {
  const html = renderToStaticMarkup(
    createElement(TextBlockSection, { content: { title: "כותרת", body } })
  )
  const match = html.match(/<p class="([^"]*)"[^>]*>[^<]*<\/p>/)
  expect(match).not.toBeNull()
  return match![1]
}

// Fix 18: a short line centred, a middle one from its start on a phone and
// centred from sm, running text from its start.
describe("lineAlignClass", () => {
  it("up to 30 characters: centred everywhere", () => {
    expect(lineAlignClass("נשמח לשמוע ממך")).toBe("text-center")
    expect(lineAlignClass("א".repeat(30))).toBe("text-center")
    expect(lineAlignClass(`  ${"א".repeat(30)}  `)).toBe("text-center")
  })

  it("31 to 60 characters: from the start on a phone, centred from sm", () => {
    expect(lineAlignClass("א".repeat(31))).toBe("text-start sm:text-center")
    expect(lineAlignClass("א".repeat(60))).toBe("text-start sm:text-center")
  })

  it("more than 60 characters or a line break: from the start", () => {
    expect(lineAlignClass("א".repeat(61))).toBe("text-start")
    expect(lineAlignClass("שורה אחת\nשורה שנייה")).toBe("text-start")
  })
})

describe("TextBlockSection's body", () => {
  it("uses the tier's class", () => {
    const short = bodyClass("נשמח לשמוע ממך")
    expect(short).toContain("text-center")
    expect(short).not.toContain("text-start")

    const middle = bodyClass("א".repeat(45))
    expect(middle).toContain("text-start")
    expect(middle).toContain("sm:text-center")
    expect(middle.split(" ")).not.toContain("text-center")

    const long = bodyClass("א".repeat(120))
    expect(long).toContain("text-start")
    expect(long).not.toContain("text-center")
  })
})
