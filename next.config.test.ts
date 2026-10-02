import { describe, expect, it } from "vitest"

import nextConfig from "./next.config.mjs"

type HeaderRule = { source: string; headers: { key: string; value: string }[] }

async function headersFor(source: string) {
  const rules = (await nextConfig.headers!()) as HeaderRule[]
  const rule = rules.find((r) => r.source === source)
  expect(rule, `no header rule for ${source}`).toBeDefined()
  return Object.fromEntries(rule!.headers.map((h) => [h.key, h.value]))
}

describe("next.config", () => {
  it.each(["/reset/:path*", "/join/:path*"])(
    "sends no-referrer and no-store on the token route %s (AD-16)",
    async (source) => {
      const headers = await headersFor(source)
      expect(headers["Referrer-Policy"]).toBe("no-referrer")
      expect(headers["Cache-Control"]).toBe("private, no-store")
    }
  )

  it.each(["/me", "/me/:path*", "/admin", "/admin/:path*"])(
    "sends no-store on %s",
    async (source) => {
      const headers = await headersFor(source)
      expect(headers["Cache-Control"]).toContain("no-store")
    }
  )

  it("does not log token routes", () => {
    const logging = nextConfig.logging
    const incoming =
      logging && typeof logging === "object"
        ? logging.incomingRequests
        : undefined
    const ignore =
      incoming && typeof incoming === "object" ? (incoming.ignore ?? []) : []
    const token = "bN4dm_qiv1VXWlUrkcMtwzzxWqcHUw190IC7CbLMvv0"

    for (const path of [`/reset/${token}`, `/join/${token}`]) {
      expect(ignore.some((pattern) => pattern.test(path))).toBe(true)
    }
    expect(ignore.some((pattern) => pattern.test("/login"))).toBe(false)
  })
})
