import { describe, expect, it } from "vitest"

import { objectPosition, publicMediaUrl, sessionPhoto } from "./photo"
import { checkSource, cropFrame, fitWithin, moveFocus } from "./resize"

const BASE = "https://abc.supabase.co/"
const row = (path: string, alt: string | null = null) => ({
  public_path: path,
  alt_text: alt,
  focus_x: 20,
  focus_y: 70,
})

describe("publicMediaUrl", () => {
  it("is the public URL of media-public, never of the drafts", () => {
    expect(publicMediaUrl("x.jpg", BASE)).toBe(
      "https://abc.supabase.co/storage/v1/object/public/media-public/x.jpg"
    )
    expect(publicMediaUrl("../media-drafts/x", BASE)).toContain(
      "/media-public/..%2Fmedia-drafts%2Fx"
    )
  })
})

describe("sessionPhoto", () => {
  it("takes the session's photo, else the concept's, else none", () => {
    expect(sessionPhoto(row("s.jpg", "alt"), row("c.jpg"), BASE)).toEqual({
      photoUrl:
        "https://abc.supabase.co/storage/v1/object/public/media-public/s.jpg",
      photoAlt: "alt",
      focusX: 20,
      focusY: 70,
    })
    expect(sessionPhoto(null, row("c.jpg"), BASE)?.photoUrl).toMatch(/c\.jpg$/)
    // An empty alt is alt="".
    expect(sessionPhoto(null, row("c.jpg"), BASE)?.photoAlt).toBe("")
    expect(sessionPhoto(null, null, BASE)).toBeNull()
  })

  it("places the focus point with object-position", () => {
    expect(objectPosition(20, 70)).toBe("20% 70%")
  })
})

describe("resize", () => {
  it("accepts jpeg, png and webp only, up to the source limit", () => {
    expect(checkSource({ type: "image/jpeg", size: 1000 })).toBeNull()
    expect(checkSource({ type: "image/webp", size: 1000 })).toBeNull()
    expect(checkSource({ type: "image/gif", size: 1000 })).toBe("notSupported")
    expect(checkSource({ type: "image/heic", size: 1000 })).toBe("notSupported")
    expect(checkSource({ type: "image/png", size: 50 * 1024 * 1024 })).toBe(
      "tooLarge"
    )
  })

  it("fits the longest side within 2000px, never enlarging", () => {
    expect(fitWithin(4000, 3000)).toEqual({ width: 2000, height: 1500 })
    expect(fitWithin(3000, 6000)).toEqual({ width: 1000, height: 2000 })
    expect(fitWithin(800, 600)).toEqual({ width: 800, height: 600 })
  })

  it("frames what an aspect shows at the focus point", () => {
    // A 4:3 photo in a square at focus x 20: the full height, 75% wide.
    const square = cropFrame(4 / 3, 1, 20, 50)
    expect(square.height).toBe(100)
    expect(square.width).toBeCloseTo(75)
    expect(square.left).toBeCloseTo(5)
    // A 2:1 card from a 3:4 photo at the bottom: the full width.
    const wide = cropFrame(3 / 4, 2, 50, 100)
    expect(wide.width).toBe(100)
    expect(wide.top + wide.height).toBeCloseTo(100)
  })

  it("keeps the focus point within 0..100", () => {
    expect(moveFocus(98, 5)).toBe(100)
    expect(moveFocus(3, -5)).toBe(0)
    expect(moveFocus(50.4, 0)).toBe(50)
  })
})
