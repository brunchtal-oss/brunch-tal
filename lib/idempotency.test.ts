import { describe, expect, it } from "vitest"

import { newIdempotencyKey } from "./idempotency"

const V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

const filled = (value: number) => (bytes: Uint8Array) => bytes.fill(value)

describe("newIdempotencyKey", () => {
  it("is a v4 UUID", () => {
    expect(newIdempotencyKey()).toMatch(V4)
    expect(newIdempotencyKey()).not.toBe(newIdempotencyKey())
  })

  it("sets the version and variant bits over the random bytes", () => {
    expect(newIdempotencyKey(filled(0x00))).toBe(
      "00000000-0000-4000-8000-000000000000"
    )
    expect(newIdempotencyKey(filled(0xff))).toBe(
      "ffffffff-ffff-4fff-bfff-ffffffffffff"
    )
  })

  it("keeps every other byte in order", () => {
    const sequence = (bytes: Uint8Array) => {
      bytes.forEach((_, i) => (bytes[i] = i * 17))
      return bytes
    }
    expect(newIdempotencyKey(sequence)).toBe(
      "00112233-4455-4677-8899-aabbccddeeff"
    )
  })
})
