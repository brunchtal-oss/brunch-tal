import { beforeEach, describe, expect, it, vi } from "vitest"

import { completeResetAction } from "./actions"

const completeReset = vi.fn()
const signInWithPassword = vi.fn()

vi.mock("@/lib/server/privileged/reset", () => ({
  completeReset: (...args: unknown[]) => completeReset(...args),
}))
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { signInWithPassword } }),
}))

const TOKEN = "t".repeat(43)

function form(fields: Record<string, string>) {
  const data = new FormData()
  for (const [key, value] of Object.entries(fields)) data.append(key, value)
  return data
}

beforeEach(() => {
  completeReset.mockReset()
  signInWithPassword.mockReset()
  vi.spyOn(console, "error").mockImplementation(() => {})
})

describe("completeResetAction", () => {
  it("returns LINK_EXPIRED when the token is missing", async () => {
    await expect(
      completeResetAction(
        null,
        form({ password: "Test-pass-123", confirm: "Test-pass-123" })
      )
    ).resolves.toEqual({ ok: false, code: "LINK_EXPIRED" })
    expect(completeReset).not.toHaveBeenCalled()
  })

  it("rejects a password shorter than 8 without calling Auth", async () => {
    await expect(
      completeResetAction(
        null,
        form({ token: TOKEN, password: "1234567", confirm: "1234567" })
      )
    ).resolves.toEqual({
      ok: false,
      code: "PASSWORD_TOO_SHORT",
      field: "password",
    })
    expect(completeReset).not.toHaveBeenCalled()
  })

  it("rejects a mismatched confirmation without calling Auth", async () => {
    await expect(
      completeResetAction(
        null,
        form({
          token: TOKEN,
          password: "Test-pass-123",
          confirm: "Test-pass-124",
        })
      )
    ).resolves.toEqual({
      ok: false,
      code: "PASSWORDS_DONT_MATCH",
      field: "confirm",
    })
    expect(completeReset).not.toHaveBeenCalled()
  })

  it("signs in with the email from the reset and returns signedIn true", async () => {
    completeReset.mockResolvedValue({
      ok: true,
      data: { email: "dev-customer@example.com" },
    })
    signInWithPassword.mockResolvedValue({ error: null })

    await expect(
      completeResetAction(
        null,
        form({
          token: TOKEN,
          password: "Test-pass-123",
          confirm: "Test-pass-123",
        })
      )
    ).resolves.toEqual({ ok: true, data: { signedIn: true } })
    expect(completeReset).toHaveBeenCalledWith(TOKEN, "Test-pass-123")
    expect(signInWithPassword).toHaveBeenCalledWith({
      email: "dev-customer@example.com",
      password: "Test-pass-123",
    })
  })

  it("returns signedIn false when the sign-in fails", async () => {
    completeReset.mockResolvedValue({
      ok: true,
      data: { email: "dev-customer@example.com" },
    })
    signInWithPassword.mockResolvedValue({
      error: { code: "invalid_credentials" },
    })

    await expect(
      completeResetAction(
        null,
        form({
          token: TOKEN,
          password: "Test-pass-123",
          confirm: "Test-pass-123",
        })
      )
    ).resolves.toEqual({ ok: true, data: { signedIn: false } })
  })

  it.each(["LINK_USED", "LINK_EXPIRED", "SERVER_ERROR"])(
    "passes a %s result through as a form error",
    async (code) => {
      completeReset.mockResolvedValue({ ok: false, code })
      await expect(
        completeResetAction(
          null,
          form({
            token: TOKEN,
            password: "Test-pass-123",
            confirm: "Test-pass-123",
          })
        )
      ).resolves.toEqual({ ok: false, code })
      expect(signInWithPassword).not.toHaveBeenCalled()
    }
  )

  it("shows an Auth weak-password rejection on the password field", async () => {
    completeReset.mockResolvedValue({ ok: false, code: "PASSWORD_TOO_SHORT" })
    await expect(
      completeResetAction(
        null,
        form({
          token: TOKEN,
          password: "Test-pass-123",
          confirm: "Test-pass-123",
        })
      )
    ).resolves.toEqual({
      ok: false,
      code: "PASSWORD_TOO_SHORT",
      field: "password",
    })
  })
})
