import { beforeEach, describe, expect, it, vi } from "vitest"

import { completeResetAction } from "./actions"

const completeReset = vi.fn()
const signInWithPassword = vi.fn()
const signOut = vi.fn()

vi.mock("@/lib/server/privileged/reset", () => ({
  completeReset: (...args: unknown[]) => completeReset(...args),
}))
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { signInWithPassword, signOut } }),
}))

const TOKEN = "t".repeat(43)
const KEY = "22222222-2222-4222-8222-222222222222"

function form(fields: Record<string, string>) {
  const data = new FormData()
  for (const [key, value] of Object.entries(fields)) data.append(key, value)
  return data
}

beforeEach(() => {
  completeReset.mockReset()
  signInWithPassword.mockReset()
  signOut.mockReset()
  signOut.mockResolvedValue({ error: null })
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

  it.each([
    ["missing", undefined],
    ["not a uuid", "not-a-uuid"],
    ["empty", ""],
  ])(
    "returns LINK_EXPIRED when the idempotency key is %s",
    async (_label, key) => {
      const fields: Record<string, string> = {
        token: TOKEN,
        password: "Test-pass-123",
        confirm: "Test-pass-123",
      }
      if (key !== undefined) fields.idempotencyKey = key
      await expect(completeResetAction(null, form(fields))).resolves.toEqual({
        ok: false,
        code: "LINK_EXPIRED",
      })
      expect(completeReset).not.toHaveBeenCalled()
    }
  )

  it("rejects a password shorter than 8 without calling Auth", async () => {
    await expect(
      completeResetAction(
        null,
        form({
          token: TOKEN,
          idempotencyKey: KEY,
          password: "1234567",
          confirm: "1234567",
        })
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
          idempotencyKey: KEY,
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
          idempotencyKey: KEY,
          password: "Test-pass-123",
          confirm: "Test-pass-123",
        })
      )
    ).resolves.toEqual({ ok: true, data: { signedIn: true } })
    expect(completeReset).toHaveBeenCalledWith(TOKEN, "Test-pass-123", KEY)
    expect(signInWithPassword).toHaveBeenCalledWith({
      email: "dev-customer@example.com",
      password: "Test-pass-123",
    })
    expect(signOut).toHaveBeenCalledWith({ scope: "others" })
  })

  it("strips invisible direction marks from a pasted token", async () => {
    completeReset.mockResolvedValue({ ok: true, data: { email: null } })
    await completeResetAction(
      null,
      form({
        token: `\u200F${TOKEN}\u200E`,
        idempotencyKey: KEY,
        password: "Test-pass-123",
        confirm: "Test-pass-123",
      })
    )
    expect(completeReset).toHaveBeenCalledWith(TOKEN, "Test-pass-123", KEY)
  })

  it("keeps the saved result when ending other sessions fails", async () => {
    completeReset.mockResolvedValue({
      ok: true,
      data: { email: "dev-customer@example.com" },
    })
    signInWithPassword.mockResolvedValue({ error: null })
    signOut.mockResolvedValue({ error: { code: "unexpected_failure" } })

    await expect(
      completeResetAction(
        null,
        form({
          token: TOKEN,
          idempotencyKey: KEY,
          password: "Test-pass-123",
          confirm: "Test-pass-123",
        })
      )
    ).resolves.toEqual({ ok: true, data: { signedIn: true } })
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
          idempotencyKey: KEY,
          password: "Test-pass-123",
          confirm: "Test-pass-123",
        })
      )
    ).resolves.toEqual({ ok: true, data: { signedIn: false } })
    expect(signOut).not.toHaveBeenCalled()
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
            idempotencyKey: KEY,
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
          idempotencyKey: KEY,
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
