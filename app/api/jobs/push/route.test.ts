import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import * as route from "./route"

const runPushWorker = vi.fn(async () => ({
  claimed: 2,
  sent: 1,
  failed: 1,
  skipped: 0,
}))

vi.mock("@/lib/server/privileged/push-worker", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/server/privileged/push-worker")>()
  return {
    ...actual,
    runPushWorker: (...args: unknown[]) => runPushWorker(...(args as [])),
  }
})

const SECRET = "s3cret-value-for-tests"

function post(authorization?: string): Request {
  return new Request("http://localhost/api/jobs/push", {
    method: "POST",
    headers: authorization ? { authorization } : {},
  })
}

beforeEach(() => {
  vi.stubEnv("CRON_SECRET", SECRET)
  vi.stubEnv("VAPID_SUBJECT", "mailto:a@example.test")
  vi.stubEnv("NEXT_PUBLIC_VAPID_PUBLIC_KEY", "pub")
  vi.stubEnv("VAPID_PRIVATE_KEY", "priv")
  runPushWorker.mockClear()
  vi.spyOn(console, "info").mockImplementation(() => {})
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe("POST /api/jobs/push", () => {
  it("runs the worker with a correct Bearer and returns counts only, no-store", async () => {
    const res = await route.POST(post(`Bearer ${SECRET}`))
    expect(res.status).toBe(200)
    expect(res.headers.get("cache-control")).toBe("no-store")
    expect(await res.json()).toEqual({
      claimed: 2,
      sent: 1,
      failed: 1,
      skipped: 0,
    })
    expect(runPushWorker).toHaveBeenCalledWith({
      subject: "mailto:a@example.test",
      publicKey: "pub",
      privateKey: "priv",
    })
  })

  it("no CRON_SECRET -> 503, the worker does not run", async () => {
    vi.stubEnv("CRON_SECRET", "")
    const res = await route.POST(post(`Bearer ${SECRET}`))
    expect(res.status).toBe(503)
    expect(runPushWorker).not.toHaveBeenCalled()
  })

  it.each([
    ["no header", undefined],
    ["a wrong secret", "Bearer wrong"],
    ["a longer secret", `Bearer ${SECRET}x`],
    ["Basic instead of Bearer", `Basic ${SECRET}`],
    ["an empty Bearer", "Bearer "],
  ])("%s -> 401", async (_label, header) => {
    const res = await route.POST(post(header))
    expect(res.status).toBe(401)
    expect(res.headers.get("cache-control")).toBe("no-store")
    expect(runPushWorker).not.toHaveBeenCalled()
  })

  it("no VAPID keys -> 503", async () => {
    vi.stubEnv("VAPID_PRIVATE_KEY", "")
    const res = await route.POST(post(`Bearer ${SECRET}`))
    expect(res.status).toBe(503)
    expect(runPushWorker).not.toHaveBeenCalled()
  })

  it("exports POST only (any other method is a 405), 60 seconds", () => {
    expect(Object.keys(route).sort()).toEqual(["POST", "maxDuration"].sort())
    expect(route.maxDuration).toBe(60)
  })
})
