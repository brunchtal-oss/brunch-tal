import { describe, expect, it } from "vitest"

import nextConfig from "./next.config.mjs"

type HeaderRule = {
  source: string
  has?: { type: string; key: string; value?: string }[]
  headers: { key: string; value: string }[]
}

async function headersFor(source: string) {
  const rules = (await nextConfig.headers!()) as HeaderRule[]
  const rule = rules.find((r) => r.source === source)
  expect(rule, `no header rule for ${source}`).toBeDefined()
  return Object.fromEntries(rule!.headers.map((h) => [h.key, h.value]))
}

describe("next.config", () => {
  it("keeps every page out of search engines until the launch (story 5.15)", async () => {
    const headers = await headersFor("/:path*")
    expect(headers["X-Robots-Tag"]).toBe("noindex, nofollow")
  })

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

  it("sends private, no-store on the session-morning view (story 3.4)", async () => {
    const rules = (await nextConfig.headers!()) as HeaderRule[]
    const path = "/admin/sessions/11111111-1111-4111-8111-111111111111/day"
    // ":path*" is zero or more segments (path-to-regexp), anchored by Next.
    const matching = rules.filter(
      (r) =>
        !r.has &&
        r.headers.some((h) => h.key === "Cache-Control") &&
        new RegExp(
          `^${r.source.replace(/[.]/g, "\\.").replace("/:path*", "(?:/.*)?")}$`
        ).test(path)
    )
    expect(matching.map((r) => r.source)).toEqual(["/admin/:path*"])
    expect(
      Object.fromEntries(matching[0].headers.map((h) => [h.key, h.value]))
    ).toMatchObject({ "Cache-Control": "private, no-store" })
  })

  it("sends no-referrer and no-store on /login only when next is a join link", async () => {
    const rules = (await nextConfig.headers!()) as HeaderRule[]
    const login = rules.filter((r) => r.source === "/login")
    expect(login).toHaveLength(1)
    const [rule] = login
    expect(rule.headers).toEqual([
      { key: "Referrer-Policy", value: "no-referrer" },
      { key: "Cache-Control", value: "private, no-store" },
    ])
    expect(rule.has).toHaveLength(1)
    const has = rule.has![0]
    expect(has).toMatchObject({ type: "query", key: "next" })
    // Next anchors the value as ^value$ against the decoded query value.
    const matcher = new RegExp(`^${has.value}$`)
    expect(matcher.test("/join/abc")).toBe(true)
    expect(matcher.test("/me")).toBe(false)
  })

  it("serves the service worker with no-cache as JavaScript (story 5.9)", async () => {
    const headers = await headersFor("/sw.js")
    expect(headers["Cache-Control"]).toBe("no-cache")
    expect(headers["Content-Type"]).toBe(
      "application/javascript; charset=utf-8"
    )
  })

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
    expect(ignore.some((pattern) => pattern.test("/login?next=/me"))).toBe(
      false
    )
    for (const path of [
      `/login?next=/join/${token}`,
      `/login?next=%2Fjoin%2F${token}`,
      `/login?x=1&next=%2Fjoin%2F${token}`,
    ]) {
      expect(ignore.some((pattern) => pattern.test(path))).toBe(true)
    }
  })
})
