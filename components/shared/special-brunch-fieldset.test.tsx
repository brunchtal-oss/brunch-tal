import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import { SPECIAL_BRUNCH_FALLBACK as SB } from "@/lib/special-brunch"

import { SpecialBrunchFieldset } from "./special-brunch-fieldset"

// The rendered <input> of one option (React orders its attributes).
function input(html: string, code: string): string {
  const match = new RegExp(
    `<input id="specialBrunchInterests-${code}"[^>]*>`
  ).exec(html)
  if (!match) throw new Error(`no input for ${code}`)
  return match[0]
}

// Story 2.16: the shared fieldset of the join forms and the profile.
describe("SpecialBrunchFieldset", () => {
  it("the question as the legend, three checkboxes, none checked or required", () => {
    const html = renderToStaticMarkup(<SpecialBrunchFieldset content={SB} />)
    expect(html).toContain(
      `<legend class="mb-2 text-base font-semibold">${SB.question}</legend>`
    )
    for (const code of ["couples", "grandma", "grandpa"]) {
      const box = input(html, code)
      expect(box).toContain('type="checkbox"')
      expect(box).toContain('name="specialBrunchInterests"')
      expect(box).toContain(`value="${code}"`)
    }
    expect(html).not.toMatch(/\schecked[=\s/>]/)
    expect(html).not.toContain("required")
    expect(html).not.toContain("(חובה)")
  })

  it("each hint is a line under its title, linked with aria-describedby", () => {
    const html = renderToStaticMarkup(<SpecialBrunchFieldset content={SB} />)
    expect(input(html, "grandma")).toContain(
      'aria-describedby="specialBrunchInterests-grandma-hint"'
    )
    expect(html).toContain(
      `<p id="specialBrunchInterests-grandma-hint" class="text-[15px] text-muted-foreground">${SB.grandma_hint}</p>`
    )
    expect(html).toContain(
      `<label for="specialBrunchInterests-grandma" class="text-base">${SB.grandma_title}</label>`
    )
  })

  it("no line and no describedby for an option without a hint", () => {
    const html = renderToStaticMarkup(
      <SpecialBrunchFieldset content={{ ...SB, couples_hint: undefined }} />
    )
    expect(html).not.toContain("specialBrunchInterests-couples-hint")
  })

  it("checks the saved answers (the profile) and shows an error", () => {
    const html = renderToStaticMarkup(
      <SpecialBrunchFieldset
        content={SB}
        defaultValue={["couples"]}
        error="bad"
      />
    )
    expect(html.match(/checked=""/g)).toHaveLength(1)
    expect(input(html, "couples")).toContain('checked=""')
    expect(html).toContain('aria-invalid="true"')
    expect(html).toContain('<p id="specialBrunchInterests-error"')
  })
})
