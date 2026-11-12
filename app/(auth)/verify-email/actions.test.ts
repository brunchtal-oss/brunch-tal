import { beforeEach, describe, expect, it, vi } from "vitest"

import { resendVerificationAction, verifyEmailAction } from "./actions"

// Story 6.11: the verification link's action (limit, shape, then
// markVerified) and the banner's resend.

const hitRateLimit = vi.fn<(...args: unknown[]) => Promise<string>>(
  async () => "allowed"
)
const markVerified = vi.fn()
const sendVerificationEmail = vi.fn()
const getClaims = vi.fn()
const getUser = vi.fn()

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
  markVerified: (...args: unknown[]) => markVerified(...args),
  sendVerificationEmail: (...args: unknown[]) => sendVerificationEmail(...args),
}))
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getClaims, getUser } }),
}))

// Our token: 32 bytes in base64url.
const TOKEN = "Abc_-".repeat(8) + "xyz"
const USER = "11111111-1111-4111-8111-111111111111"

function form(token?: string) {
  const data = new FormData()
  if (token !== undefined) data.append("token", token)
  return data
}

beforeEach(() => {
  hitRateLimit.mockClear()
  markVerified.mockReset()
  sendVerificationEmail.mockReset()
  getClaims.mockReset()
  getUser.mockReset()
})

describe("verifyEmailAction", () => {
  // The browser's session (the account's own login is required).
  beforeEach(() => {
    getClaims.mockResolvedValue({ data: { claims: { sub: USER } } })
  })

  it("limits first by IP and token, then uses the token for the session user", async () => {
    markVerified.mockResolvedValue({ ok: true, isAdmin: false })
    await expect(verifyEmailAction(null, form(TOKEN))).resolves.toEqual({
      ok: true,
      isAdmin: false,
    })
    expect(hitRateLimit).toHaveBeenCalledWith("token", {
      ip: "203.0.113.7",
      id: TOKEN,
    })
    expect(markVerified).toHaveBeenCalledWith(TOKEN, USER)
  })

  it("signed out: NOT_AUTHORIZED (the login prompt), and the token is never used", async () => {
    getClaims.mockResolvedValue({ data: null })
    await expect(verifyEmailAction(null, form(TOKEN))).resolves.toEqual({
      ok: false,
      code: "NOT_AUTHORIZED",
    })
    expect(markVerified).not.toHaveBeenCalled()
  })

  it("another account signed in: LINK_INVALID from the database (the token stays unused there)", async () => {
    const OTHER = "33333333-3333-4333-8333-333333333333"
    getClaims.mockResolvedValue({ data: { claims: { sub: OTHER } } })
    markVerified.mockResolvedValue({ ok: false, code: "LINK_INVALID" })
    await expect(verifyEmailAction(null, form(TOKEN))).resolves.toEqual({
      ok: false,
      code: "LINK_INVALID",
    })
    // The session user, never anything from the form.
    expect(markVerified).toHaveBeenCalledWith(TOKEN, OTHER)
  })

  it("never takes a user id from the form", async () => {
    markVerified.mockResolvedValue({ ok: true, isAdmin: false })
    const data = form(TOKEN)
    data.append("p_session_user_id", "33333333-3333-4333-8333-333333333333")
    data.append("userId", "33333333-3333-4333-8333-333333333333")
    await verifyEmailAction(null, data)
    expect(markVerified).toHaveBeenCalledWith(TOKEN, USER)
  })

  it.each([[undefined], [""], ["bad hash!"], ["x".repeat(400)]])(
    "refuses a malformed token %j before the database",
    async (value) => {
      await expect(verifyEmailAction(null, form(value))).resolves.toEqual({
        ok: false,
        code: "LINK_INVALID",
      })
      expect(markVerified).not.toHaveBeenCalled()
    }
  )

  it("stops at the rate limit before the token is used", async () => {
    hitRateLimit.mockResolvedValueOnce("blocked")
    await expect(verifyEmailAction(null, form(TOKEN))).resolves.toEqual({
      ok: false,
      code: "TOO_MANY_ATTEMPTS",
    })
    expect(markVerified).not.toHaveBeenCalled()
  })

  it("passes LINK_INVALID through (used, expired)", async () => {
    markVerified.mockResolvedValue({ ok: false, code: "LINK_INVALID" })
    await expect(verifyEmailAction(null, form(TOKEN))).resolves.toEqual({
      ok: false,
      code: "LINK_INVALID",
    })
  })
})

describe("resendVerificationAction", () => {
  it("needs a session", async () => {
    getClaims.mockResolvedValue({ data: null })
    await expect(resendVerificationAction()).resolves.toEqual({
      ok: false,
      code: "NOT_AUTHORIZED",
    })
    expect(hitRateLimit).not.toHaveBeenCalled()
  })

  const signedIn = () => {
    getClaims.mockResolvedValue({ data: { claims: { sub: USER } } })
    getUser.mockResolvedValue({
      data: { user: { email: "her@example.com" } },
      error: null,
    })
  }

  it("limits per resend:<user id>, then sends to her account", async () => {
    signedIn()
    sendVerificationEmail.mockResolvedValue("sent")
    await expect(resendVerificationAction()).resolves.toEqual({
      ok: true,
      data: { email: "her@example.com", alreadyVerified: false },
    })
    expect(hitRateLimit).toHaveBeenCalledWith("email", {
      ip: "203.0.113.7",
      id: `resend:${USER}`,
    })
    expect(sendVerificationEmail).toHaveBeenCalledWith(USER)
  })

  it("already verified: ok with alreadyVerified, and nothing was sent", async () => {
    signedIn()
    sendVerificationEmail.mockResolvedValue("verified")
    await expect(resendVerificationAction()).resolves.toEqual({
      ok: true,
      data: { email: "her@example.com", alreadyVerified: true },
    })
  })

  it("stops at the limit before sending", async () => {
    signedIn()
    hitRateLimit.mockResolvedValueOnce("blocked")
    await expect(resendVerificationAction()).resolves.toEqual({
      ok: false,
      code: "TOO_MANY_ATTEMPTS",
    })
    expect(sendVerificationEmail).not.toHaveBeenCalled()
  })

  it("a failed send is SERVER_ERROR", async () => {
    signedIn()
    sendVerificationEmail.mockResolvedValue("failed")
    await expect(resendVerificationAction()).resolves.toEqual({
      ok: false,
      code: "SERVER_ERROR",
    })
  })
})
