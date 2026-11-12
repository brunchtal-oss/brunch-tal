import { beforeEach, describe, expect, it, vi } from "vitest"

import {
  checkPassword,
  completeRecovery,
  linkErrorCode,
  markVerified,
  sendResetIfEligible,
  sendVerificationEmail,
} from "./email-auth"

// Story 6.11: the stateless Auth client (the reset request, verifyOtp, the
// password check) and the service-role RPCs (our verification token, the
// eligibility), mocked.

const verifyOtp = vi.fn()
const signOut = vi.fn<(...args: unknown[]) => Promise<{ error: unknown }>>(
  async () => ({ error: null })
)
const signInWithPassword = vi.fn()
const resetPasswordForEmail = vi.fn()
const rpc = vi.fn()
const updateUserById = vi.fn()
// A forged Host / Origin: the verification link must never be built from it.
const requestHeaders = vi.hoisted(() =>
  vi.fn(
    async () =>
      new Headers({ host: "evil.example", origin: "https://evil.example" })
  )
)
vi.mock("next/headers", () => ({ headers: requestHeaders }))

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    auth: { verifyOtp, signOut, signInWithPassword, resetPasswordForEmail },
  }),
}))
vi.mock("@/lib/server/privileged/service-client", () => ({
  createServiceClient: () => ({
    rpc: (name: string, args: unknown) => rpc(name, args),
    auth: { admin: { updateUserById } },
  }),
}))

const USER = "11111111-1111-4111-8111-111111111111"
const HASH = "c".repeat(56)

function rpcAnswers(answers: Record<string, unknown>) {
  rpc.mockImplementation(async (name: string) => ({
    data: answers[name],
    error: null,
  }))
}

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co")
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_x")
  vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://site.example.test/")
  for (const mock of [
    verifyOtp,
    signInWithPassword,
    resetPasswordForEmail,
    rpc,
    updateUserById,
  ]) {
    mock.mockReset()
  }
  signOut.mockClear()
  signOut.mockResolvedValue({ error: null })
  vi.spyOn(console, "error").mockImplementation(() => {})
})

describe("linkErrorCode", () => {
  it("maps verifyOtp's refusals", () => {
    expect(linkErrorCode({ status: 403, code: "otp_expired" })).toBe(
      "LINK_INVALID"
    )
    expect(linkErrorCode({ status: 429 })).toBe("TOO_MANY_ATTEMPTS")
    expect(linkErrorCode({ status: 500 })).toBe("SERVER_ERROR")
    expect(linkErrorCode({})).toBe("SERVER_ERROR")
  })
})

describe("sendVerificationEmail (our token, through the database)", () => {
  it("asks request_email_verification with the user id and the site's address", async () => {
    rpcAnswers({ request_email_verification: { sent: true } })
    await expect(sendVerificationEmail(USER)).resolves.toBe("sent")
    expect(rpc).toHaveBeenCalledWith("request_email_verification", {
      p_user_id: USER,
      p_site_url: "https://site.example.test",
    })
  })

  it("the link's site comes from the environment only, never from the request's Host or Origin", async () => {
    rpcAnswers({ request_email_verification: { sent: true } })
    await sendVerificationEmail(USER)
    expect(requestHeaders).not.toHaveBeenCalled()
    const call = rpc.mock.calls.find(
      ([name]) => name === "request_email_verification"
    )
    expect(call?.[1]).toEqual({
      p_user_id: USER,
      p_site_url: "https://site.example.test",
    })
  })

  it("already verified: nothing sent", async () => {
    rpcAnswers({
      request_email_verification: { sent: false, reason: "verified" },
    })
    await expect(sendVerificationEmail(USER)).resolves.toBe("verified")
  })

  it("no key in Vault, or an error: failed, never thrown", async () => {
    rpcAnswers({ request_email_verification: { sent: false } })
    await expect(sendVerificationEmail(USER)).resolves.toBe("failed")
    rpc.mockRejectedValue(new Error("down"))
    await expect(sendVerificationEmail(USER)).resolves.toBe("failed")
  })
})

describe("sendResetIfEligible", () => {
  it("asks Auth only for an eligible address", async () => {
    rpcAnswers({
      get_email_reset_eligibility: { user_id: USER, eligible: false },
    })
    await sendResetIfEligible("a@example.com")
    expect(resetPasswordForEmail).not.toHaveBeenCalled()

    rpcAnswers({
      get_email_reset_eligibility: { user_id: USER, eligible: true },
    })
    resetPasswordForEmail.mockResolvedValue({ error: null })
    await sendResetIfEligible("a@example.com")
    expect(resetPasswordForEmail).toHaveBeenCalledWith("a@example.com")
  })

  it("swallows a failure and logs no address", async () => {
    rpc.mockRejectedValue(new Error("down"))
    await expect(sendResetIfEligible("a@example.com")).resolves.toBeUndefined()
    expect(resetPasswordForEmail).not.toHaveBeenCalled()
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain(
      "a@example.com"
    )
  })
})

describe("markVerified (our token)", () => {
  it("consumes the token; no Auth call, nobody logs in", async () => {
    rpcAnswers({ consume_email_verification: { is_admin: true } })
    await expect(markVerified("tok_123456789012345", USER)).resolves.toEqual({
      ok: true,
      isAdmin: true,
    })
    expect(rpc).toHaveBeenCalledWith("consume_email_verification", {
      p_token: "tok_123456789012345",
      p_session_user_id: USER,
    })
    expect(verifyOtp).not.toHaveBeenCalled()
    expect(signInWithPassword).not.toHaveBeenCalled()
  })

  it("LINK_INVALID passes through; anything else is SERVER_ERROR", async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { code: "P0001", message: "LINK_INVALID" },
    })
    await expect(markVerified("tok_123456789012345", USER)).resolves.toEqual({
      ok: false,
      code: "LINK_INVALID",
    })
    rpc.mockResolvedValue({ data: null, error: { code: "XX000" } })
    await expect(markVerified("tok_123456789012345", USER)).resolves.toEqual({
      ok: false,
      code: "SERVER_ERROR",
    })
  })
})

describe("completeRecovery", () => {
  const recovered = {
    data: { user: { id: USER, email: "a@example.com" } },
    error: null,
  }
  const eligible = () =>
    rpcAnswers({
      get_email_reset_eligibility: { user_id: USER, eligible: true },
    })

  it("an account no longer eligible: LINK_INVALID, no password change, its session dropped", async () => {
    verifyOtp.mockResolvedValue(recovered)
    rpcAnswers({
      get_email_reset_eligibility: { user_id: USER, eligible: false },
    })
    await expect(completeRecovery(HASH, "New-pass-123")).resolves.toEqual({
      ok: false,
      code: "LINK_INVALID",
    })
    expect(updateUserById).not.toHaveBeenCalled()
    expect(signOut).toHaveBeenCalledWith({ scope: "local" })
  })

  it("the eligibility read fails after the link was used: LINK_INVALID (a new link), its session dropped", async () => {
    verifyOtp.mockResolvedValue(recovered)
    rpc.mockRejectedValue(new Error("down"))
    await expect(completeRecovery(HASH, "New-pass-123")).resolves.toEqual({
      ok: false,
      code: "LINK_INVALID",
    })
    expect(updateUserById).not.toHaveBeenCalled()
    expect(signOut).toHaveBeenCalledWith({ scope: "local" })
  })

  it("eligibility of another user (the address moved): LINK_INVALID", async () => {
    verifyOtp.mockResolvedValue(recovered)
    rpcAnswers({
      get_email_reset_eligibility: {
        user_id: "22222222-2222-4222-8222-222222222222",
        eligible: true,
      },
    })
    await expect(completeRecovery(HASH, "New-pass-123")).resolves.toEqual({
      ok: false,
      code: "LINK_INVALID",
    })
    expect(updateUserById).not.toHaveBeenCalled()
  })

  it("eligible: the new password, then every session of hers ends (global)", async () => {
    verifyOtp.mockResolvedValue(recovered)
    eligible()
    updateUserById.mockResolvedValue({ data: {}, error: null })
    await expect(completeRecovery(HASH, "New-pass-123")).resolves.toEqual({
      ok: true,
      email: "a@example.com",
    })
    expect(verifyOtp).toHaveBeenCalledWith({
      token_hash: HASH,
      type: "recovery",
    })
    expect(updateUserById).toHaveBeenCalledWith(USER, {
      password: "New-pass-123",
    })
    expect(signOut.mock.calls).toEqual([[{ scope: "global" }]])
  })

  it("same_password counts as saved", async () => {
    verifyOtp.mockResolvedValue(recovered)
    eligible()
    updateUserById.mockResolvedValue({
      data: {},
      error: { code: "same_password", status: 422 },
    })
    await expect(completeRecovery(HASH, "New-pass-123")).resolves.toEqual({
      ok: true,
      email: "a@example.com",
    })
    expect(signOut).toHaveBeenCalledWith({ scope: "global" })
  })

  it("another 4xx on the password: LINK_INVALID (its screen leads to a new link)", async () => {
    verifyOtp.mockResolvedValue(recovered)
    eligible()
    updateUserById.mockResolvedValue({
      data: {},
      error: { code: "weak_password", status: 422 },
    })
    await expect(completeRecovery(HASH, "New-pass-123")).resolves.toEqual({
      ok: false,
      code: "LINK_INVALID",
    })
    expect(signOut).toHaveBeenCalledWith({ scope: "local" })
  })

  it("a 5xx after verifyOtp: SERVER_ERROR, its session dropped", async () => {
    verifyOtp.mockResolvedValue(recovered)
    eligible()
    updateUserById.mockResolvedValue({
      data: {},
      error: { code: "unexpected_failure", status: 500 },
    })
    await expect(completeRecovery(HASH, "New-pass-123")).resolves.toEqual({
      ok: false,
      code: "SERVER_ERROR",
    })
    expect(signOut).toHaveBeenCalledWith({ scope: "local" })
  })

  it("a used or expired link: LINK_INVALID before anything else", async () => {
    verifyOtp.mockResolvedValue({
      data: { user: null },
      error: { status: 403, code: "otp_expired" },
    })
    await expect(completeRecovery(HASH, "New-pass-123")).resolves.toEqual({
      ok: false,
      code: "LINK_INVALID",
    })
    expect(rpc).not.toHaveBeenCalled()
  })
})

describe("checkPassword", () => {
  it("ok: the session it opened is ended at once", async () => {
    signInWithPassword.mockResolvedValue({ error: null })
    await expect(checkPassword("a@example.com", "pw-123456")).resolves.toBe(
      "ok"
    )
    expect(signInWithPassword).toHaveBeenCalledWith({
      email: "a@example.com",
      password: "pw-123456",
    })
    expect(signOut).toHaveBeenCalledWith({ scope: "local" })
  })

  it.each([
    [{ code: "invalid_credentials", status: 400 }, "wrong"],
    [{ code: "over_request_rate_limit", status: 429 }, "limited"],
    [{ code: "unexpected_failure", status: 500 }, "failed"],
  ])("maps %j to %s", async (error, expected) => {
    signInWithPassword.mockResolvedValue({ error })
    await expect(checkPassword("a@example.com", "pw-123456")).resolves.toBe(
      expected
    )
    expect(signOut).not.toHaveBeenCalled()
  })

  it("a thrown error is failed", async () => {
    signInWithPassword.mockRejectedValue(new Error("network"))
    await expect(checkPassword("a@example.com", "pw-123456")).resolves.toBe(
      "failed"
    )
  })
})
