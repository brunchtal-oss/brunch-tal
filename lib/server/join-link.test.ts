import { beforeEach, describe, expect, it, vi } from "vitest"

import { joinLinkFor, resetLinkFor } from "./join-link"

const headerValues = new Map<string, string>()

vi.mock("next/headers", () => ({
  headers: async () => ({
    get: (name: string) => headerValues.get(name) ?? null,
  }),
}))

const TOKEN = "t".repeat(43)

beforeEach(() => {
  headerValues.clear()
})

describe("resetLinkFor (story 2.8)", () => {
  it("uses the Origin of the request", async () => {
    headerValues.set("origin", "https://brunch.example")
    await expect(resetLinkFor(TOKEN)).resolves.toBe(
      `https://brunch.example/reset/${TOKEN}`
    )
    await expect(joinLinkFor(TOKEN)).resolves.toBe(
      `https://brunch.example/join/${TOKEN}`
    )
  })

  it("without an Origin, falls back to the forwarded host and protocol", async () => {
    headerValues.set("x-forwarded-host", "192.168.1.5:3000")
    headerValues.set("x-forwarded-proto", "http")
    await expect(resetLinkFor(TOKEN)).resolves.toBe(
      `http://192.168.1.5:3000/reset/${TOKEN}`
    )
  })

  it("host alone is https; no address at all is null", async () => {
    headerValues.set("host", "brunch.example")
    await expect(resetLinkFor(TOKEN)).resolves.toBe(
      `https://brunch.example/reset/${TOKEN}`
    )
    headerValues.clear()
    await expect(resetLinkFor(TOKEN)).resolves.toBeNull()
  })
})
