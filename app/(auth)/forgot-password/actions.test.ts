import { beforeEach, describe, expect, it, vi } from "vitest"

import { requestResetAction } from "./actions"

// Story 6.11: the forgot-password action. The rate limit comes first; the
// answer is the same for every address; the eligibility read and the send
// run only in after(), never before the answer.

const order: string[] = []
const hitRateLimit = vi.fn<(...args: unknown[]) => Promise<string>>(
  async () => {
    order.push("limit")
    return "allowed"
  }
)
const sendResetIfEligible = vi.fn<(...args: unknown[]) => Promise<void>>(
  async () => {
    order.push("send")
  }
)
const afterTasks: (() => unknown)[] = []

vi.mock("next/server", () => ({
  after: (task: () => unknown) => {
    order.push("after")
    afterTasks.push(task)
  },
}))
vi.mock("@/lib/server/privileged/rate-limit", () => ({
  clientIp: async () => "203.0.113.7",
  hitRateLimit: (...args: unknown[]) => hitRateLimit(...args),
  rateLimitCode: (v: string) =>
    v === "allowed"
      ? null
      : v === "blocked"
        ? "TOO_MANY_ATTEMPTS"
        : "SERVER_ERROR",
}))
vi.mock("@/lib/server/privileged/email-auth", () => ({
  sendResetIfEligible: (...args: unknown[]) => sendResetIfEligible(...args),
}))

function form(email: string) {
  const data = new FormData()
  data.append("email", email)
  return data
}

beforeEach(() => {
  order.length = 0
  afterTasks.length = 0
  hitRateLimit.mockClear()
  sendResetIfEligible.mockClear()
})

describe("requestResetAction", () => {
  it("limits first, per IP and per normalized address", async () => {
    await requestResetAction(null, form("  Someone@Example.COM "))
    expect(order[0]).toBe("limit")
    expect(hitRateLimit).toHaveBeenCalledWith("email", {
      ip: "203.0.113.7",
      id: "someone@example.com",
    })
  })

  it("answers TOO_MANY_ATTEMPTS when blocked and sends nothing", async () => {
    hitRateLimit.mockResolvedValueOnce("blocked")
    const result = await requestResetAction(null, form("a@example.com"))
    expect(result).toMatchObject({ ok: false, code: "TOO_MANY_ATTEMPTS" })
    expect(afterTasks).toEqual([])
  })

  it("refuses a malformed address before anything is queued", async () => {
    const result = await requestResetAction(null, form("not-an-email"))
    expect(result).toMatchObject({ ok: false, code: "INVALID_INPUT" })
    expect(afterTasks).toEqual([])
  })

  it("gives the same answer for every address, and decides only in after()", async () => {
    const answers = []
    for (const email of [
      "unknown@example.com",
      "unverified@example.com",
      "eligible@example.com",
    ]) {
      answers.push(await requestResetAction(null, form(email)))
    }
    expect(answers).toEqual([
      { ok: true, email: "unknown@example.com" },
      { ok: true, email: "unverified@example.com" },
      { ok: true, email: "eligible@example.com" },
    ])
    // Nothing was read or sent before the answers.
    expect(sendResetIfEligible).not.toHaveBeenCalled()
    for (const task of afterTasks) await task()
    expect(sendResetIfEligible.mock.calls).toEqual([
      ["unknown@example.com"],
      ["unverified@example.com"],
      ["eligible@example.com"],
    ])
  })
})
