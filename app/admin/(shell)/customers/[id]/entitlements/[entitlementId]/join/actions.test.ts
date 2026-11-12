import { beforeEach, describe, expect, it, vi } from "vitest"

import { submitJoinFillAction } from "./actions"

// Story 6.11: the verification email is queued in after().
const afterTasks: (() => unknown)[] = []
const sendVerificationEmail = vi.fn()
vi.mock("next/server", () => ({
  after: (task: () => unknown) => {
    afterTasks.push(task)
  },
}))
vi.mock("@/lib/server/privileged/email-auth", () => ({
  sendVerificationEmail: (...args: unknown[]) => sendVerificationEmail(...args),
}))

const submitJoinFill = vi.fn()
const rpc = vi.fn()
const signInWithPassword = vi.fn()

vi.mock("@/lib/server/privileged/join", () => ({
  submitJoinFill: (...args: unknown[]) => submitJoinFill(...args),
}))
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ rpc, auth: { signInWithPassword } }),
}))

const PAYMENT = "33333333-3333-4333-8333-333333333333"
const KEY = "22222222-2222-4222-8222-222222222222"
const TOKEN = "f".repeat(43)
const PASSWORD = "Test-pass-123"
const CUSTOMER = "44444444-4444-4444-8444-444444444444"

const VALID: Array<[string, string]> = [
  ["paymentId", PAYMENT],
  ["idempotencyKey", KEY],
  ["fullName", " Dev Fill "],
  ["phone", "054-1234567"],
  ["email", "dev-fill@example.com"],
  ["babyName", "Baby"],
  ["birthDate", "2026-09-01"],
  ["password", PASSWORD],
  ["confirm", PASSWORD],
  ["privacyConsent", "on"],
  ["photoConsent", "no"],
  ["personalPhotoConsent", "yes"],
]

function form(extra: Array<[string, string]> = [], skip: string[] = []) {
  const data = new FormData()
  for (const [name, value] of [...VALID, ...extra]) {
    if (!skip.includes(name)) data.append(name, value)
  }
  return data
}

beforeEach(() => {
  submitJoinFill.mockReset()
  rpc.mockReset()
  signInWithPassword.mockReset()
  rpc.mockResolvedValue({ data: "admin", error: null })
})

describe("submitJoinFillAction (story 2.15)", () => {
  it.each(["customer", "none"])(
    "refuses a %s session before anything else",
    async (role) => {
      rpc.mockResolvedValue({ data: role, error: null })
      await expect(submitJoinFillAction(null, form())).resolves.toEqual({
        status: "error",
        code: "NOT_AUTHORIZED",
        errors: [],
      })
      expect(rpc).toHaveBeenCalledWith("get_my_session_role")
      expect(submitJoinFill).not.toHaveBeenCalled()
    }
  )

  it("a failed role lookup is SERVER_ERROR, not NOT_AUTHORIZED", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "XX000" } })
    vi.spyOn(console, "error").mockImplementation(() => {})
    await expect(submitJoinFillAction(null, form())).resolves.toEqual({
      status: "error",
      code: "SERVER_ERROR",
      errors: [],
    })
    expect(submitJoinFill).not.toHaveBeenCalled()
  })

  it("checks the shape: a bad payment id, then the shared field rules", async () => {
    await expect(
      submitJoinFillAction(null, form([["paymentId", "x"]], ["paymentId"]))
    ).resolves.toMatchObject({ status: "error", code: "INVALID_INPUT" })
    const missing = await submitJoinFillAction(null, form([], ["fullName"]))
    expect(missing).toMatchObject({
      status: "error",
      errors: [{ field: "fullName", message: "FIELD_REQUIRED" }],
    })
    expect(submitJoinFill).not.toHaveBeenCalled()
  })

  it("joined: the name and email, never the password, and no sign-in", async () => {
    submitJoinFill.mockResolvedValue({
      token: TOKEN,
      result: {
        ok: true,
        data: {
          outcome: "joined",
          email: "dev-fill@example.com",
          customerId: CUSTOMER,
        },
      },
    })
    const state = await submitJoinFillAction(null, form())
    expect(state).toEqual({
      status: "fill_joined",
      fullName: "Dev Fill",
      email: "dev-fill@example.com",
      customerId: CUSTOMER,
      token: null,
    })
    expect(JSON.stringify(state)).not.toContain(PASSWORD)
    expect(signInWithPassword).not.toHaveBeenCalled()
    const [, paymentId, input, key, token] = submitJoinFill.mock.calls[0]
    expect([paymentId, key, token]).toEqual([PAYMENT, KEY, null])
    expect(input).toMatchObject({ fullName: "Dev Fill", password: PASSWORD })
    // Story 6.11: the verification email, after the answer.
    for (const task of afterTasks.splice(0)) await task()
    expect(sendVerificationEmail).toHaveBeenLastCalledWith(CUSTOMER)
  })

  it("passes the carried token of the previous attempt", async () => {
    submitJoinFill.mockResolvedValue({
      token: TOKEN,
      result: { ok: false, code: "SERVER_ERROR" },
    })
    await expect(
      submitJoinFillAction(null, form([["token", TOKEN]]))
    ).resolves.toEqual({
      status: "error",
      code: "SERVER_ERROR",
      errors: [],
      token: TOKEN,
    })
    expect(submitJoinFill.mock.calls[0][4]).toBe(TOKEN)
  })

  it.each([
    ["details_taken", false],
    ["existing_account", false],
    ["identity_retry", true],
    ["email_exists", true],
  ])(
    "%s: an error on the email field, the form stays",
    async (outcome, newKey) => {
      submitJoinFill.mockResolvedValue({
        token: outcome === "details_taken" ? null : TOKEN,
        result: { ok: true, data: { outcome } },
      })
      const state = await submitJoinFillAction(null, form())
      expect(state).toMatchObject({
        status: "error",
        errors: [{ field: "email", message: "detailsTaken" }],
      })
      expect(typeof state?.idempotencyKey === "string").toBe(newKey)
    }
  )

  it.each([
    ["LINK_USED", { status: "used", token: null }],
    ["PURCHASE_VOIDED", { status: "voided", token: null }],
    ["LINK_IN_PROGRESS", { status: "in_progress", token: null }],
  ])("maps %s", async (code, expected) => {
    submitJoinFill.mockResolvedValue({
      token: null,
      result: { ok: false, code },
    })
    await expect(submitJoinFillAction(null, form())).resolves.toEqual(expected)
  })

  it("an ended internal link: begin again with a new key", async () => {
    submitJoinFill.mockResolvedValue({
      token: TOKEN,
      result: { ok: false, code: "LINK_EXPIRED" },
    })
    const state = await submitJoinFillAction(null, form([["token", TOKEN]]))
    expect(state).toMatchObject({
      status: "error",
      code: "CONCURRENT_CHANGE",
      token: null,
    })
    expect(state?.idempotencyKey).not.toBe(KEY)
  })

  it("a repeat key whose raw link is gone gets a new key", async () => {
    submitJoinFill.mockResolvedValue({
      token: null,
      result: { ok: false, code: "CONCURRENT_CHANGE" },
    })
    const state = await submitJoinFillAction(null, form())
    expect(state).toMatchObject({
      status: "error",
      code: "CONCURRENT_CHANGE",
      token: null,
    })
    expect(state?.idempotencyKey).toMatch(/^[0-9a-f-]{36}$/)
    expect(state?.idempotencyKey).not.toBe(KEY)
  })

  it("a conflict drops the token", async () => {
    submitJoinFill.mockResolvedValue({
      token: TOKEN,
      result: { ok: true, data: { outcome: "conflict", reason: null } },
    })
    await expect(submitJoinFillAction(null, form())).resolves.toEqual({
      status: "conflict",
      reason: null,
      token: null,
    })
  })
})
