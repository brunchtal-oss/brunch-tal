import { beforeEach, describe, expect, it, vi } from "vitest"

import { claimJoinAction, submitJoinAction } from "./actions"
import { validateJoin } from "./join-input"

const submitJoin = vi.fn()
const getJoinTokenView = vi.fn()
const signInWithPassword = vi.fn()
const rpc = vi.fn()
const getClaims = vi.fn()
const redirect = vi.fn((path: string) => {
  throw new Error(`REDIRECT:${path}`)
})

vi.mock("@/lib/server/privileged/join", () => ({
  submitJoin: (...args: unknown[]) => submitJoin(...args),
  getJoinTokenView: (...args: unknown[]) => getJoinTokenView(...args),
}))
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { signInWithPassword, getClaims },
    rpc,
  }),
}))
vi.mock("next/navigation", () => ({
  redirect: (path: string) => redirect(path),
}))

const TOKEN = "t".repeat(43)
const KEY = "22222222-2222-4222-8222-222222222222"
const PASSWORD = "Test-pass-123"

const VALID: Array<[string, string]> = [
  ["token", TOKEN],
  ["idempotencyKey", KEY],
  ["fullName", " Dev Join "],
  ["phone", "054-1234567"],
  ["email", "dev-join@example.com"],
  ["babyName", "Baby"],
  ["birthDate", "2026-09-01"],
  ["dietaryNotes", "  "],
  ["password", PASSWORD],
  ["confirm", PASSWORD],
  ["privacyConsent", "on"],
  ["photoConsent", "no"],
]

function form(
  overrides: Record<string, string | string[] | null> = {},
  extra: Array<[string, string]> = []
) {
  const data = new FormData()
  for (const [name, value] of VALID) {
    if (name in overrides) continue
    data.append(name, value)
  }
  for (const [name, value] of Object.entries(overrides)) {
    if (value === null) continue
    for (const v of Array.isArray(value) ? value : [value]) data.append(name, v)
  }
  for (const [name, value] of extra) data.append(name, value)
  return data
}

beforeEach(() => {
  submitJoin.mockReset()
  getJoinTokenView.mockReset()
  signInWithPassword.mockReset()
  rpc.mockReset()
  getClaims.mockReset()
  getClaims.mockResolvedValue({ data: { claims: { sub: "u" } } })
  redirect.mockClear()
  vi.spyOn(console, "error").mockImplementation(() => {})
})

describe("validateJoin", () => {
  it("accepts a complete form and normalizes the optional fields", () => {
    expect(validateJoin(form())).toEqual({
      ok: true,
      input: {
        email: "dev-join@example.com",
        phone: "054-1234567",
        password: PASSWORD,
        fullName: "Dev Join",
        dietaryNotes: null,
        privacyConsent: true,
        photoConsent: false,
        babies: [{ name: "Baby", birthDate: "2026-09-01" }],
      },
    })
  })

  it("reads every baby row in order", () => {
    const result = validateJoin(
      form({ babyName: ["A", "B"], birthDate: ["2026-09-01", "2026-09-02"] })
    )
    expect(result.ok && result.input.babies).toEqual([
      { name: "A", birthDate: "2026-09-01" },
      { name: "B", birthDate: "2026-09-02" },
    ])
  })

  it("returns every missing field at once", () => {
    const result = validateJoin(
      form({
        fullName: "",
        phone: "",
        email: "",
        babyName: "",
        birthDate: "",
        password: "",
        confirm: "",
        privacyConsent: null,
        photoConsent: null,
      })
    )
    expect(result).toEqual({
      ok: false,
      errors: [
        { field: "fullName", message: "FIELD_REQUIRED" },
        { field: "phone", message: "FIELD_REQUIRED" },
        { field: "email", message: "FIELD_REQUIRED" },
        { field: "babyName", index: 0, message: "FIELD_REQUIRED" },
        { field: "birthDate", index: 0, message: "FIELD_REQUIRED" },
        { field: "password", message: "FIELD_REQUIRED" },
        { field: "privacy", message: "CONSENT_REQUIRED" },
        { field: "photoConsent", message: "photoConsent" },
      ],
    })
  })

  it("flags a malformed phone and email", () => {
    const result = validateJoin(form({ phone: "12", email: "no-at-sign" }))
    expect(result).toEqual({
      ok: false,
      errors: [
        { field: "phone", message: "phone" },
        { field: "email", message: "email" },
      ],
    })
  })

  it("flags the second baby by its index", () => {
    const result = validateJoin(
      form({ babyName: ["A", ""], birthDate: ["2026-09-01", ""] })
    )
    expect(result).toEqual({
      ok: false,
      errors: [
        { field: "babyName", index: 1, message: "FIELD_REQUIRED" },
        { field: "birthDate", index: 1, message: "FIELD_REQUIRED" },
      ],
    })
  })

  it("requires matching passwords of at least 8 characters", () => {
    expect(
      validateJoin(form({ password: "1234567", confirm: "1234567" }))
    ).toMatchObject({ errors: [{ field: "password" }] })
    expect(validateJoin(form({ confirm: "other-pass-1" }))).toMatchObject({
      errors: [{ field: "confirm", message: "PASSWORDS_DONT_MATCH" }],
    })
    expect(validateJoin(form({ confirm: "" }))).toMatchObject({
      errors: [{ field: "confirm", message: "FIELD_REQUIRED" }],
    })
  })

  it("treats 'private' as a full answer to the photo question", () => {
    const yes = validateJoin(form({ photoConsent: "yes" }))
    const no = validateJoin(form({ photoConsent: "no" }))
    expect(yes.ok && yes.input.photoConsent).toBe(true)
    expect(no.ok && no.input.photoConsent).toBe(false)
    expect(validateJoin(form({ photoConsent: "maybe" }))).toMatchObject({
      ok: false,
    })
  })
})

describe("submitJoinAction", () => {
  it.each([
    ["the token is missing", { token: null }],
    ["the key is missing", { idempotencyKey: null }],
    ["the key is not a uuid", { idempotencyKey: "nope" }],
  ])("shows the expired screen when %s", async (_label, overrides) => {
    await expect(submitJoinAction(null, form(overrides))).resolves.toEqual({
      status: "expired",
    })
    expect(submitJoin).not.toHaveBeenCalled()
  })

  it("never calls the server with invalid fields", async () => {
    const result = await submitJoinAction(null, form({ privacyConsent: null }))
    expect(result).toEqual({
      status: "error",
      code: "INVALID_INPUT",
      errors: [{ field: "privacy", message: "CONSENT_REQUIRED" }],
    })
    expect(submitJoin).not.toHaveBeenCalled()
  })

  it("cleans invisible marks from the token, then signs in and goes to /me", async () => {
    submitJoin.mockResolvedValue({
      ok: true,
      data: { outcome: "joined", email: "dev-join@example.com" },
    })
    signInWithPassword.mockResolvedValue({ error: null })

    await expect(
      submitJoinAction(null, form({ token: `%E2%80%8F${TOKEN}` }))
    ).rejects.toThrow("REDIRECT:/me")
    expect(submitJoin).toHaveBeenCalledWith(
      TOKEN,
      expect.objectContaining({ fullName: "Dev Join", photoConsent: false }),
      KEY
    )
    expect(signInWithPassword).toHaveBeenCalledWith({
      email: "dev-join@example.com",
      password: PASSWORD,
    })
  })

  it("shows the login screen when the sign-in after joining fails", async () => {
    submitJoin.mockResolvedValue({
      ok: true,
      data: { outcome: "joined", email: "dev-join@example.com" },
    })
    signInWithPassword.mockResolvedValue({
      error: { code: "invalid_credentials" },
    })
    await expect(submitJoinAction(null, form())).resolves.toEqual({
      status: "joined",
    })
    expect(redirect).not.toHaveBeenCalled()
  })

  it("sends an existing account back to the page, without signing in", async () => {
    submitJoin.mockResolvedValue({
      ok: true,
      data: { outcome: "existing_account" },
    })
    await expect(submitJoinAction(null, form())).rejects.toThrow(
      `REDIRECT:/join/${TOKEN}`
    )
    expect(signInWithPassword).not.toHaveBeenCalled()
  })

  it("shows the conflict screen with its reason", async () => {
    submitJoin.mockResolvedValue({
      ok: true,
      data: { outcome: "conflict", reason: "not_activated" },
    })
    await expect(submitJoinAction(null, form())).resolves.toEqual({
      status: "conflict",
      reason: "not_activated",
    })
    expect(signInWithPassword).not.toHaveBeenCalled()
  })

  it("keeps the form after identity_retry and hands a new idempotency key", async () => {
    submitJoin.mockResolvedValue({
      ok: true,
      data: { outcome: "identity_retry" },
    })
    const result = await submitJoinAction(null, form())
    expect(result).toEqual({
      status: "identity_retry",
      idempotencyKey: expect.stringMatching(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
      ),
    })
    expect(
      result?.status === "identity_retry" && result.idempotencyKey
    ).not.toBe(KEY)
    expect(signInWithPassword).not.toHaveBeenCalled()
    expect(redirect).not.toHaveBeenCalled()
  })

  it("keeps the form after email_exists and hands a new idempotency key", async () => {
    submitJoin.mockResolvedValue({
      ok: true,
      data: { outcome: "email_exists" },
    })
    const result = await submitJoinAction(null, form())
    expect(result).toEqual({
      status: "email_exists",
      idempotencyKey: expect.stringMatching(/^[0-9a-f-]{36}$/),
    })
    expect(result?.status === "email_exists" && result.idempotencyKey).not.toBe(
      KEY
    )
    expect(signInWithPassword).not.toHaveBeenCalled()
  })

  it.each([
    ["LINK_USED", { status: "used" }],
    ["LINK_EXPIRED", { status: "expired" }],
    ["LINK_IN_USE", { status: "error", code: "LINK_IN_USE", errors: [] }],
    ["SERVER_ERROR", { status: "error", code: "SERVER_ERROR", errors: [] }],
  ])("maps %s", async (code, expected) => {
    submitJoin.mockResolvedValue({ ok: false, code })
    await expect(submitJoinAction(null, form())).resolves.toEqual(expected)
  })

  it.each([
    [{ field: "phone" }, { field: "phone", message: "phone" }],
    [{ field: "email" }, { field: "email", message: "email" }],
    [
      { field: "birth_date", index: 1 },
      { field: "birthDate", index: 1, message: "birthDate" },
    ],
    [
      { field: "photo_consent" },
      { field: "photoConsent", message: "photoConsent" },
    ],
    [
      { field: "baby_name", index: 1 },
      { field: "babyName", index: 1, message: "FIELD_REQUIRED" },
    ],
    [{ field: "full_name" }, { field: "fullName", message: "INVALID_INPUT" }],
    [
      { field: "babies" },
      { field: "babyName", index: 0, message: "INVALID_INPUT" },
    ],
  ])(
    "maps the server's INVALID_INPUT %j to its field",
    async (detail, error) => {
      submitJoin.mockResolvedValue({ ok: false, code: "INVALID_INPUT", detail })
      await expect(submitJoinAction(null, form())).resolves.toEqual({
        status: "error",
        code: "INVALID_INPUT",
        errors: [error],
      })
    }
  )

  it("maps PASSWORD_TOO_SHORT from Auth to the password field", async () => {
    submitJoin.mockResolvedValue({ ok: false, code: "PASSWORD_TOO_SHORT" })
    await expect(submitJoinAction(null, form())).resolves.toEqual({
      status: "error",
      code: "PASSWORD_TOO_SHORT",
      errors: [{ field: "password", message: "PASSWORD_TOO_SHORT" }],
    })
  })

  it("maps CONSENT_REQUIRED from the server to the privacy checkbox", async () => {
    submitJoin.mockResolvedValue({ ok: false, code: "CONSENT_REQUIRED" })
    await expect(submitJoinAction(null, form())).resolves.toEqual({
      status: "error",
      code: "CONSENT_REQUIRED",
      errors: [{ field: "privacy", message: "CONSENT_REQUIRED" }],
    })
  })
})

describe("claimJoinAction", () => {
  const claimForm = (overrides: Record<string, string | null> = {}) => {
    const data = new FormData()
    for (const [name, value] of Object.entries({
      token: TOKEN,
      idempotencyKey: KEY,
      ...overrides,
    })) {
      if (value !== null) data.append(name, value)
    }
    return data
  }
  const notAuthorized = {
    data: null,
    error: { code: "P0001", message: "NOT_AUTHORIZED" },
  }

  it.each([
    ["the token is missing", { token: null }],
    ["the key is not a uuid", { idempotencyKey: "nope" }],
  ])("shows the expired screen when %s", async (_label, overrides) => {
    await expect(claimJoinAction(null, claimForm(overrides))).resolves.toEqual({
      status: "expired",
    })
    expect(rpc).not.toHaveBeenCalled()
  })

  it("claims with the session client, then goes to /me", async () => {
    rpc.mockResolvedValue({
      data: { outcome: "claimed", payment_id: "pay-1" },
      error: null,
    })
    await expect(
      claimJoinAction(null, claimForm({ token: `%E2%80%8F${TOKEN}` }))
    ).rejects.toThrow("REDIRECT:/me")
    expect(rpc).toHaveBeenCalledWith("claim_join", {
      p_token: TOKEN,
      p_idempotency_key: KEY,
    })
    expect(getJoinTokenView).not.toHaveBeenCalled()
  })

  it("shows the conflict screen for a bind conflict", async () => {
    rpc.mockResolvedValue({ data: { outcome: "conflict" }, error: null })
    await expect(claimJoinAction(null, claimForm())).resolves.toEqual({
      status: "conflict",
      reason: "bind_conflict",
    })
    expect(redirect).not.toHaveBeenCalled()
  })

  it.each([
    ["used", { status: "used" }],
    ["expired", { status: "expired" }],
    ["conflict", { status: "conflict", reason: "two_accounts" }],
    ["awaiting_login", { status: "other_account" }],
  ])(
    "reads the link again after NOT_AUTHORIZED: %s",
    async (state, expected) => {
      rpc.mockResolvedValue(notAuthorized)
      getJoinTokenView.mockResolvedValue({
        state,
        productName: null,
        amountAgorot: null,
        conflictReason: state === "conflict" ? "two_accounts" : null,
      })
      await expect(claimJoinAction(null, claimForm())).resolves.toEqual(
        expected
      )
      expect(getJoinTokenView).toHaveBeenCalledWith(TOKEN)
    }
  )

  it("sends an active (unbound) link back to the page", async () => {
    rpc.mockResolvedValue(notAuthorized)
    getJoinTokenView.mockResolvedValue({ state: "active" })
    await expect(claimJoinAction(null, claimForm())).rejects.toThrow(
      `REDIRECT:/join/${TOKEN}`
    )
  })

  it("sends a session that ended since the page opened to the login", async () => {
    rpc.mockResolvedValue(notAuthorized)
    getJoinTokenView.mockResolvedValue({ state: "awaiting_login" })
    getClaims.mockResolvedValue({ data: null })
    await expect(claimJoinAction(null, claimForm())).rejects.toThrow(
      `REDIRECT:/login?next=%2Fjoin%2F${TOKEN}`
    )
  })

  it("shows a server error when reading the link again fails", async () => {
    rpc.mockResolvedValue(notAuthorized)
    getJoinTokenView.mockRejectedValue(new Error("token_view failed"))
    await expect(claimJoinAction(null, claimForm())).resolves.toEqual({
      status: "error",
      code: "SERVER_ERROR",
    })
  })

  it("passes other codes through", async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { code: "PGRST000", message: "x" },
    })
    await expect(claimJoinAction(null, claimForm())).resolves.toEqual({
      status: "error",
      code: "SERVER_ERROR",
    })
  })
})
