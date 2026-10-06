import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import { LegalText, parseLegalText, safeHref } from "./legal-text"

const html = (text: string) => renderToStaticMarkup(<LegalText text={text} />)

describe("LegalText (story 5.5)", () => {
  it("splits paragraphs on a blank line and keeps a single line break", () => {
    const out = html("first\nsecond\n\nthird")
    expect(out).toContain("<p>first<br/>second</p>")
    expect(out).toContain("<p>third</p>")
  })

  it("turns lines starting with '- ' into a list", () => {
    const out = html("intro\n- one\n- two\nafter")
    expect(out).toContain("<p>intro</p>")
    expect(out).toMatch(/<ul[^>]*><li>one<\/li><li>two<\/li><\/ul>/)
    expect(out).toContain("<p>after</p>")
  })

  it("renders **bold**", () => {
    expect(html("a **b** c")).toContain(
      'a <strong class="font-semibold">b</strong> c'
    )
  })

  it("links https in a new tab with noopener noreferrer", () => {
    const out = html("[site](https://example.com/a)")
    expect(out).toContain('href="https://example.com/a"')
    expect(out).toContain('target="_blank"')
    expect(out).toContain('rel="noopener noreferrer"')
  })

  it("links a phone (tel:) and an email (mailto:) in place", () => {
    const out = html(
      "[054-4256456](tel:+972544256456) [mail](mailto:a@example.com)"
    )
    expect(out).toContain('href="tel:+972544256456"')
    expect(out).toContain('href="mailto:a@example.com"')
    expect(out).not.toContain("target=")
  })

  it("keeps any other address and HTML as plain text", () => {
    const out = html("[x](javascript:alert(1)) <b>bold</b> [y](http://e.com)")
    expect(out).not.toContain("<a")
    expect(out).not.toContain("<b>")
    expect(out).toContain("&lt;b&gt;bold&lt;/b&gt;")
    expect(out).not.toContain("javascript")
    expect(out).toContain("x")
    expect(out).toContain("y")
  })

  it("refuses unsafe addresses", () => {
    expect(safeHref("javascript:alert(1)")).toBeNull()
    expect(safeHref("data:text/html,x")).toBeNull()
    expect(safeHref("http://e.com")).toBeNull()
    expect(safeHref("tel:abc")).toBeNull()
    expect(safeHref("tel:()")).toBeNull()
    expect(safeHref("tel:--")).toBeNull()
    expect(safeHref("https://e.com")).toEqual({
      href: "https://e.com",
      external: true,
    })
  })

  it("ignores empty input and Windows line ends", () => {
    expect(parseLegalText("")).toEqual([])
    expect(parseLegalText("a\r\n\r\nb")).toHaveLength(2)
  })

  it("keeps bold inside a link's label", () => {
    const out = html("[**x**](https://e.com)")
    expect(out).toContain('<strong class="font-semibold">x</strong>')
    expect(out).not.toContain("**")
    expect(out).toContain('href="https://e.com"')
  })

  it("turns a line starting with '## ' into an h2", () => {
    const out = html("## First\n\ntext\n## Second\nmore")
    expect(out).toMatch(/<h2 class="[^"]*font-heading[^"]*">First<\/h2>/)
    expect(out).toMatch(/<h2 class="[^"]*mt-6[^"]*">Second<\/h2>/)
    expect(out).toContain("<p>text</p>")
    expect(out).toContain("<p>more</p>")
    expect(parseLegalText("## A")).toEqual([
      { type: "heading", text: [{ type: "text", text: "A" }] },
    ])
  })

  it("keeps '##' as text anywhere else", () => {
    const out = html("a ## b\n##c\n###x")
    expect(out).not.toContain("<h2")
    expect(out).toContain("a ## b<br/>##c<br/>###x")
  })
})
