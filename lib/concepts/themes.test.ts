import { describe, expect, it } from "vitest"

import { PAPERS, PAPER_KEYS, THEMES, conceptTheme } from "./themes"

// WCAG 2.x relative luminance and contrast ratio.
function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

describe("concept themes", () => {
  it("every field and ink pair reads at 4.5:1 or more", () => {
    for (const { field, ink } of [
      ...Object.values(THEMES),
      ...Object.values(PAPERS),
    ]) {
      expect(contrast(field, ink), `${ink} on ${field}`).toBeGreaterThanOrEqual(
        4.5
      )
    }
  })

  it("maps each theme key to its own values", () => {
    expect(conceptTheme("mothers")).toEqual(THEMES.mothers)
    expect(conceptTheme("greek").face).toBe("suez-one")
    expect(conceptTheme("couples").headerSize).toBe(46)
  })

  it("generic takes its paper, with the heading face", () => {
    for (const key of PAPER_KEYS) {
      expect(conceptTheme("generic", key)).toMatchObject({
        ...PAPERS[key],
        face: "heebo",
      })
    }
  })

  it("falls back to the olive paper for an unknown or missing key", () => {
    expect(conceptTheme("generic", null)).toMatchObject(PAPERS.olive)
    expect(conceptTheme("new-theme")).toMatchObject(PAPERS.olive)
    expect(conceptTheme(undefined)).toMatchObject(PAPERS.olive)
  })
})
