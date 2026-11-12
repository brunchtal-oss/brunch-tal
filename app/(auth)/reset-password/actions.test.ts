import { beforeEach, describe, expect, it, vi } from "vitest"

import { resetPasswordAction } from "./actions"

// Story 6.11: the reset link's action. The limit, then the form's shape,
// so a bad form never uses the link; then completeRecovery; then the
// browser is signed in, other sessions end, and she lands by her role.

const hitRateLimit = vi.fn<(...args: unknown[]) => Promise<string>>(
  async () => "allowed"
)
const completeRecovery = vi.fn()
const signInWithPassword = vi.fn()
const signOut = vi.fn()
const rpc = vi.fn()
const redirect = vi.fn((path: string) => {
  throw new Error(`REDIRECT ${path}`)
})

vi.mock("next/navigation", () => ({
  redirect: (path: string) => redirect(path),
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
  completeRecovery: (...args: unknown[]) => completeRecovery(...args),
}))
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { signInWithPassword, signOut },
    rpc: (name: string) => rpc(name),
  }),
}))

const HASH = "b".repeat(56)

function form(fields: Record<string, string>) {
  const data = new FormData()
  for (const [key, value] of Object.entries(fields)) data.append(key, value)
  return data
}

const good = {
  token_hash: HASH,
  password: "Test-pass-123",
  confirm: "Test-pass-123",
}

beforeEach(() => {
  hitRateLimit.mockClear()
  completeRecovery.mockReset()
  signInWithPassword.mockReset()
  signOut.mockReset()
  signOut.mockResolvedValue({ error: null })
  rpc.mockReset()
  redirect.mockClear()
  vi.spyOn(console, "error").mockImplementation(() => {})
})

describe("resetPasswordAction", () => {
  it("stops at the limit (token bucket, per token_hash) before the link", async () => {
    hitRateLimit.mockResolvedValueOnce("blocked")
    await expect(resetPasswordAction(null, form(good))).resolves.toEqual({
      ok: false,
      code: "TOO_MANY_ATTEMPTS",
    })
    expect(hitRateLimit).toHaveBeenCalledWith("token", {
      ip: "203.0.113.7",
      id: HASH,
    })
    expect(completeRecovery).not.toHaveBeenCalled()
  })

  it("checks the shape before verifyOtp: a short password", async () => {
    await expect(
      resetPasswordAction(
        null,
        form({ ...good, password: "1234567", confirm: "1234567" })
      )
    ).resolves.toEqual({
      ok: false,
      code: "PASSWORD_TOO_SHORT",
      field: "password",
    })
    expect(completeRecovery).not.toHaveBeenCalled()
  })

  it("checks the shape before verifyOtp: over 72 bytes (Hebrew letters count twice)", async () => {
    // 37 Hebrew letters = 74 bytes; 72 ASCII bytes still pass.
    const long = "א".repeat(37)
    await expect(
      resetPasswordAction(
        null,
        form({ ...good, password: long, confirm: long })
      )
    ).resolves.toEqual({
      ok: false,
      code: "PASSWORD_TOO_LONG",
      field: "password",
    })
    expect(completeRecovery).not.toHaveBeenCalled()

    completeRecovery.mockResolvedValue({ ok: false, code: "LINK_INVALID" })
    const max = "a".repeat(72)
    await resetPasswordAction(
      null,
      form({ ...good, password: max, confirm: max })
    )
    expect(completeRecovery).toHaveBeenCalledWith(HASH, max)
  })

  it("checks the shape before verifyOtp: a mismatch", async () => {
    await expect(
      resetPasswordAction(null, form({ ...good, confirm: "Other-pass-123" }))
    ).resolves.toEqual({
      ok: false,
      code: "PASSWORDS_DONT_MATCH",
      field: "confirm",
    })
    expect(completeRecovery).not.toHaveBeenCalled()
  })

  it("a missing or malformed token_hash is LINK_INVALID, with no Auth call", async () => {
    await expect(
      resetPasswordAction(null, form({ ...good, token_hash: "" }))
    ).resolves.toEqual({ ok: false, code: "LINK_INVALID" })
    expect(completeRecovery).not.toHaveBeenCalled()
  })

  it.each(["LINK_INVALID", "SERVER_ERROR"])(
    "passes %s through and never signs in",
    async (code) => {
      completeRecovery.mockResolvedValue({ ok: false, code })
      await expect(resetPasswordAction(null, form(good))).resolves.toEqual({
        ok: false,
        code,
      })
      expect(signInWithPassword).not.toHaveBeenCalled()
    }
  )

  it.each([
    ["admin", "/admin"],
    ["customer", "/me"],
  ])(
    "signs in, ends other sessions, and sends an %s to %s",
    async (role, path) => {
      completeRecovery.mockResolvedValue({ ok: true, email: "a@example.com" })
      signInWithPassword.mockResolvedValue({ error: null })
      rpc.mockResolvedValue({ data: role, error: null })
      await expect(resetPasswordAction(null, form(good))).rejects.toThrow(
        `REDIRECT ${path}`
      )
      expect(completeRecovery).toHaveBeenCalledWith(HASH, "Test-pass-123")
      expect(signInWithPassword).toHaveBeenCalledWith({
        email: "a@example.com",
        password: "Test-pass-123",
      })
      expect(signOut).toHaveBeenCalledWith({ scope: "others" })
    }
  )

  it("saved but the sign-in failed: ok, she logs in herself", async () => {
    completeRecovery.mockResolvedValue({ ok: true, email: "a@example.com" })
    signInWithPassword.mockResolvedValue({ error: { code: "x" } })
    await expect(resetPasswordAction(null, form(good))).resolves.toEqual({
      ok: true,
    })
    expect(redirect).not.toHaveBeenCalled()
  })
})
