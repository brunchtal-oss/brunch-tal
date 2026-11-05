import { describe, expect, it } from "vitest"

import { shellCopy } from "@/lib/copy/shell"

import { buildLlmsTxt, markdownText } from "./llms"

const copy = shellCopy.public.llms

describe("markdownText", () => {
  it("escapes Markdown structure and keeps one line", () => {
    expect(markdownText("a [link](https://x) # *b*\n<c>")).toBe(
      "a \\[link\\]\\(https://x\\) \\# \\*b\\* \\<c\\>"
    )
    expect(markdownText("- item")).toBe("\\- item")
    expect(markdownText("054-425-6456")).toBe("054-425-6456")
  })
})

describe("buildLlmsTxt (fix-seo-editor)", () => {
  const text = buildLlmsTxt({
    name: "שם העסק",
    description: "תיאור האתר",
    base: "https://example.co.il",
    pages: [
      { title: "שם העסק", path: "/", description: null },
      { title: "גלריה", path: "/gallery", description: "תיאור [גלריה]" },
    ],
    sessions: [
      {
        id: "11111111-1111-4111-8111-111111111111",
        concept_name: "יווני",
        starts_at: "2026-12-01T08:00:00Z",
        display_price_agorot: 12000,
      },
      {
        id: "22222222-2222-4222-8222-222222222222",
        concept_name: "איטלקי",
        starts_at: "2026-12-08T08:00:00Z",
        display_price_agorot: null,
      },
    ],
    policies: [{ title: "הצהרת נגישות", path: "/accessibility" }],
  })

  it("the name, the description, the pages, the sessions and the policies", () => {
    expect(text).toBe(
      [
        "# שם העסק",
        "",
        "> תיאור האתר",
        "",
        `## ${copy.pages}`,
        "",
        "- [שם העסק](https://example.co.il/)",
        "- [גלריה](https://example.co.il/gallery): תיאור \\[גלריה\\]",
        "",
        `## ${copy.sessions}`,
        "",
        "- [בראנץ׳ יווני](https://example.co.il/sessions/11111111-1111-4111-8111-111111111111): יום שלישי 01.12 · 10:00, 120 ₪",
        "- [בראנץ׳ איטלקי](https://example.co.il/sessions/22222222-2222-4222-8222-222222222222): יום שלישי 08.12 · 10:00",
        "",
        `## ${copy.policies}`,
        "",
        "- [הצהרת נגישות](https://example.co.il/accessibility)",
        "",
      ].join("\n")
    )
  })

  it("leaves out the sessions heading without sessions", () => {
    const empty = buildLlmsTxt({
      name: "n",
      description: null,
      base: "https://e.co",
      pages: [],
      sessions: [],
      policies: [],
    })
    expect(empty).toBe(`# n\n\n## ${copy.pages}\n\n`)
  })
})
