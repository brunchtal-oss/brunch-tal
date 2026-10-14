import { beforeEach, describe, expect, it, vi } from "vitest"

import { loginAction } from "./actions"

const signInWithPassword = vi.fn()
const signOut = vi.fn(async () => ({ error: null }))
const rpc = vi.fn()

// next/navigation's redirect() throws to stop rendering; the mock does too.
class RedirectSignal extends Error {
  constructor(public url: string) {
    super(`REDIRECT ${url}`)
  }
}

const hitRateLimit = vi.fn<(...args: unknown[]) => Promise<string>>(
  async () => "allowed"
)
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
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new RedirectSignal(url)
  },
}))
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { signInWithPassword, signOut }, rpc }),
}))

function form(fields: Record<string, string>) {
  const data = new FormData()
  for (const [key, value] of Object.entries(fields)) data.append(key, value)
  return data
}

async function redirectTarget(promise: Promise<unknown>) {
  const error = await promise.then(
    () => null,
    (e: unknown) => e
  )
  expect(error).toBeInstanceOf(RedirectSignal)
  return (error as RedirectSignal).url
}

const credentials = {
  email: "dev-customer@example.com",
  password: "Test-pass-123",
}

function signedInAs(role: string) {
  signInWithPassword.mockResolvedValue({ error: null })
  rpc.mockResolvedValue({ data: role, error: null })
}

beforeEach(() => {
  hitRateLimit.mockReset()
  hitRateLimit.mockResolvedValue("allowed")
  signInWithPassword.mockReset()
  signOut.mockClear()
  rpc.mockReset()
  vi.spyOn(console, "error").mockImplementation(() => {})
})

describe("loginAction", () => {
  it("stops at the rate limit before Auth, keyed by IP and normalized email (story 2.8)", async () => {
    hitRateLimit.mockResolvedValue("blocked")

    await expect(
      loginAction(
        null,
        form({ email: " Dev-Customer@Example.com ", password: "x" })
      )
    ).resolves.toEqual({
      ok: false,
      code: "TOO_MANY_ATTEMPTS",
      email: " Dev-Customer@Example.com ",
    })
    expect(hitRateLimit).toHaveBeenCalledWith("login", {
      ip: "203.0.113.7",
      id: "dev-customer@example.com",
    })
    expect(signInWithPassword).not.toHaveBeenCalled()
  })

  it("blocks with a server error when the limiter itself fails (user decision 2026-10-13)", async () => {
    hitRateLimit.mockResolvedValue("failed")

    await expect(
      loginAction(null, form({ email: "a@example.com", password: "x" }))
    ).resolves.toEqual({
      ok: false,
      code: "SERVER_ERROR",
      email: "a@example.com",
    })
    expect(signInWithPassword).not.toHaveBeenCalled()
  })

  it.each([
    [{ code: "over_request_rate_limit", status: 429 }],
    [{ code: undefined, status: 429 }],
  ])("maps Supabase's own rate limit to TOO_MANY_ATTEMPTS", async (error) => {
    signInWithPassword.mockResolvedValue({ error })

    await expect(loginAction(null, form(credentials))).resolves.toEqual({
      ok: false,
      code: "TOO_MANY_ATTEMPTS",
      email: "dev-customer@example.com",
    })
  })

  it("returns INVALID_CREDENTIALS with the email echoed on bad credentials", async () => {
    signInWithPassword.mockResolvedValue({
      error: { code: "invalid_credentials", status: 400 },
    })

    await expect(loginAction(null, form(credentials))).resolves.toEqual({
      ok: false,
      code: "INVALID_CREDENTIALS",
      email: "dev-customer@example.com",
    })
  })

  it("returns INVALID_CREDENTIALS for empty fields without calling Auth", async () => {
    await expect(
      loginAction(
        null,
        form({ email: "dev-customer@example.com", password: "" })
      )
    ).resolves.toEqual({
      ok: false,
      code: "INVALID_CREDENTIALS",
      email: "dev-customer@example.com",
    })
    expect(signInWithPassword).not.toHaveBeenCalled()
  })

  it.each([
    ["a 5xx", { code: "unexpected_failure", status: 503 }],
    ["a network failure (status 0)", { code: undefined, status: 0 }],
    ["a network failure (no status)", { code: undefined, status: undefined }],
  ])(
    "returns SERVER_ERROR when Auth answers with %s",
    async (_label, error) => {
      signInWithPassword.mockResolvedValue({ error })

      await expect(loginAction(null, form(credentials))).resolves.toEqual({
        ok: false,
        code: "SERVER_ERROR",
        email: "dev-customer@example.com",
      })
    }
  )

  it("redirects a customer to an internal next", async () => {
    signedInAs("customer")
    await expect(
      redirectTarget(
        loginAction(
          null,
          form({ ...credentials, next: "/me/bookings?tab=credits" })
        )
      )
    ).resolves.toBe("/me/bookings?tab=credits")
    expect(signInWithPassword).toHaveBeenCalledWith(credentials)
    expect(rpc).toHaveBeenCalledWith("get_my_session_role")
    expect(signOut).not.toHaveBeenCalled()
  })

  it.each([
    ["missing", undefined],
    ["external", "https://evil.example"],
    ["protocol-relative", "//evil.com"],
    ["inside /admin", "/admin"],
  ])("redirects a customer to /me when next is %s", async (_label, next) => {
    signedInAs("customer")
    const fields: Record<string, string> = { ...credentials }
    if (next) fields.next = next
    await expect(redirectTarget(loginAction(null, form(fields)))).resolves.toBe(
      "/me"
    )
  })

  it.each([
    ["missing", undefined, "/admin"],
    ["/me", "/me", "/admin"],
    ["/admin/more", "/admin/more", "/admin/more"],
    ["protocol-relative", "//evil.com", "/admin"],
  ])("redirects an admin with next %s", async (_label, next, expected) => {
    signedInAs("admin")
    const fields: Record<string, string> = { ...credentials }
    if (next) fields.next = next
    await expect(redirectTarget(loginAction(null, form(fields)))).resolves.toBe(
      expected
    )
  })

  it("signs out a user with no active profile (ACCOUNT_NOT_ACTIVE)", async () => {
    signedInAs("none")
    await expect(
      loginAction(null, form({ ...credentials, next: "/me" }))
    ).resolves.toEqual({
      ok: false,
      code: "ACCOUNT_NOT_ACTIVE",
      email: "dev-customer@example.com",
    })
    expect(signOut).toHaveBeenCalledTimes(1)
  })

  it("signs out and returns SERVER_ERROR when the role lookup fails", async () => {
    signInWithPassword.mockResolvedValue({ error: null })
    rpc.mockRejectedValue(new Error("fetch failed"))
    await expect(loginAction(null, form(credentials))).resolves.toEqual({
      ok: false,
      code: "SERVER_ERROR",
      email: "dev-customer@example.com",
    })
    expect(signOut).toHaveBeenCalledTimes(1)
  })
})
