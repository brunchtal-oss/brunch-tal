import { describe, expect, it } from "vitest"

import { center, clampIndex, nearestIndex } from "./carousel"

// Three items 80px wide with a 16px gap, the track's centre at x = 200.
// RTL lays the first item at the right and moves on toward the left.
const rtlItems = (scrolled: number) =>
  [0, 1, 2].map((i) => {
    const right = 240 - i * 96 + scrolled
    return { left: right - 80, right }
  })
const ltrItems = (scrolled: number) =>
  [0, 1, 2].map((i) => {
    const left = 160 + i * 96 - scrolled
    return { left, right: left + 80 }
  })

describe("center", () => {
  it("is the middle of the rect", () => {
    expect(center({ left: 10, right: 30 })).toBe(20)
  })
})

describe("nearestIndex", () => {
  it("finds the centred item in RTL", () => {
    expect(nearestIndex(200, rtlItems(0))).toBe(0)
    expect(nearestIndex(200, rtlItems(96))).toBe(1)
    expect(nearestIndex(200, rtlItems(60))).toBe(1)
    expect(nearestIndex(200, rtlItems(40))).toBe(0)
    expect(nearestIndex(200, rtlItems(192))).toBe(2)
  })

  it("finds the centred item in LTR", () => {
    expect(nearestIndex(200, ltrItems(0))).toBe(0)
    expect(nearestIndex(200, ltrItems(96))).toBe(1)
    expect(nearestIndex(200, ltrItems(192))).toBe(2)
  })

  it("gives -1 for no items", () => {
    expect(nearestIndex(0, [])).toBe(-1)
  })
})

describe("clampIndex", () => {
  it("keeps the index within the items", () => {
    expect(clampIndex(-1, 3)).toBe(0)
    expect(clampIndex(1, 3)).toBe(1)
    expect(clampIndex(5, 3)).toBe(2)
    expect(clampIndex(2, 0)).toBe(0)
  })
})
