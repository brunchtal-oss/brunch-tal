import { beforeEach, describe, expect, it, vi } from "vitest"

import { loginAction } from "./actions"

const signInWithPassword = vi.fn()

// next/navigation's redirect() throws to stop rendering; the mock does too.
class RedirectSignal extends Error {
  constructor(public url: string) {
    super(`REDIRECT ${url}`)
  }
}

vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new RedirectSignal(url)
  },
}))
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { signInWithPassword } }),
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

beforeEach(() => {
  signInWithPassword.mockReset()
  vi.spyOn(console, "error").mockImplementation(() => {})
})

describe("loginAction", () => {
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
    ["a 429 rate limit", { code: "over_request_rate_limit", status: 429 }],
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

  it("redirects to an internal next after a successful sign-in", async () => {
    signInWithPassword.mockResolvedValue({ error: null })
    await expect(
      redirectTarget(
        loginAction(
          null,
          form({ ...credentials, next: "/me/bookings?tab=credits" })
        )
      )
    ).resolves.toBe("/me/bookings?tab=credits")
    expect(signInWithPassword).toHaveBeenCalledWith(credentials)
  })

  it.each([
    ["missing", undefined],
    ["external", "https://evil.example"],
    ["protocol-relative", "//evil.example"],
  ])("redirects to /me when next is %s", async (_label, next) => {
    signInWithPassword.mockResolvedValue({ error: null })
    const fields: Record<string, string> = { ...credentials }
    if (next) fields.next = next
    await expect(redirectTarget(loginAction(null, form(fields)))).resolves.toBe(
      "/me"
    )
  })
})
