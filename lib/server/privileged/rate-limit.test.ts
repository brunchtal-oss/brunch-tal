import { beforeEach, describe, expect, it, vi } from "vitest"

import {
  clientIp,
  clientIpFrom,
  hitRateLimit,
  rateLimitCode,
} from "./rate-limit"

const rpc = vi.fn()
const headerValues = new Map<string, string>()

vi.mock("@/lib/server/privileged/service-client", () => ({
  createServiceClient: () => ({ rpc }),
}))
vi.mock("next/headers", () => ({
  headers: async () => ({
    get: (name: string) => headerValues.get(name) ?? null,
  }),
}))

function headersOf(values: Record<string, string>) {
  return new Headers(values)
}

beforeEach(() => {
  rpc.mockReset()
  headerValues.clear()
  vi.spyOn(console, "error").mockImplementation(() => {})
})

describe("clientIpFrom", () => {
  it("takes x-real-ip first", () => {
    expect(
      clientIpFrom(
        headersOf({
          "x-real-ip": " 203.0.113.7 ",
          "x-forwarded-for": "1.1.1.1",
        })
      )
    ).toBe("203.0.113.7")
  })

  it("else the first address of x-forwarded-for", () => {
    expect(
      clientIpFrom(
        headersOf({ "x-forwarded-for": " 198.51.100.2 , 10.0.0.1, 10.0.0.2" })
      )
    ).toBe("198.51.100.2")
  })

  it("else unknown", () => {
    expect(clientIpFrom(headersOf({}))).toBe("unknown")
    expect(clientIpFrom(headersOf({ "x-real-ip": "  " }))).toBe("unknown")
    expect(clientIpFrom(headersOf({ "x-forwarded-for": " , " }))).toBe(
      "unknown"
    )
  })

  it("clientIp reads the request headers", async () => {
    headerValues.set("x-real-ip", "203.0.113.9")
    await expect(clientIp()).resolves.toBe("203.0.113.9")
  })
})

describe("hitRateLimit", () => {
  it("sends the bucket and both keys, prefixed", async () => {
    rpc.mockResolvedValue({ data: { allowed: true }, error: null })
    await expect(
      hitRateLimit("login", { ip: "203.0.113.7", id: "dana@example.com" })
    ).resolves.toBe("allowed")
    expect(rpc).toHaveBeenCalledWith("rate_limit_hit", {
      p_bucket: "login",
      p_keys: ["ip:203.0.113.7", "id:dana@example.com"],
    })
  })

  it("answers blocked when the SQL says not allowed", async () => {
    rpc.mockResolvedValue({ data: { allowed: false }, error: null })
    await expect(
      hitRateLimit("token", { ip: "unknown", id: "t".repeat(43) })
    ).resolves.toBe("blocked")
  })

  it("answers failed when the limiter fails, and logs no key", async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { code: "PGRST000", message: "down" },
    })
    await expect(
      hitRateLimit("login", { ip: "203.0.113.7", id: "dana@example.com" })
    ).resolves.toBe("failed")
    const logged = JSON.stringify(vi.mocked(console.error).mock.calls)
    expect(logged).toContain("rate_limit.failed")
    expect(logged).not.toContain("dana@example.com")
    expect(logged).not.toContain("203.0.113.7")
  })

  it("answers failed when the call throws", async () => {
    rpc.mockRejectedValue(new Error("network"))
    await expect(
      hitRateLimit("token", { ip: "203.0.113.7", id: "x".repeat(43) })
    ).resolves.toBe("failed")
  })

  it("caps each key at 512 characters", async () => {
    rpc.mockResolvedValue({ data: { allowed: true }, error: null })
    await hitRateLimit("login", { ip: "1.2.3.4", id: "a".repeat(600) })
    const keys = rpc.mock.calls[0][1].p_keys as string[]
    expect(keys[1]).toHaveLength(512)
  })
})

describe("rateLimitCode", () => {
  it("stops a blocked or failed attempt, lets an allowed one go on", () => {
    expect(rateLimitCode("allowed")).toBeNull()
    expect(rateLimitCode("blocked")).toBe("TOO_MANY_ATTEMPTS")
    // A failure of the limiter blocks too (user decision 2026-10-13).
    expect(rateLimitCode("failed")).toBe("SERVER_ERROR")
  })

  it("answers failed on an unexpected result", async () => {
    rpc.mockResolvedValue({ data: {}, error: null })
    await expect(
      hitRateLimit("login", { ip: "203.0.113.7", id: "dana@example.com" })
    ).resolves.toBe("failed")
  })
})
