import { beforeEach, describe, expect, it, vi } from "vitest"

import { updateDetailsWithEmailAction } from "./actions"

// Story 6.11 (user decision 2026-11-12): the details form with a new email.
// The session, the details' shape, the limit (its own id, change:<user
// id>), the email's shape, her current address from Auth (never the
// session's claims), then changeOwnEmail, which checks her password first
// and only then runs the details' write (its afterPasswordCheck) before the
// change. After a change her session is refreshed and the verification
// email is queued in after().

const order: string[] = []
const hitRateLimit = vi.fn<(...args: unknown[]) => Promise<string>>(
  async () => {
    order.push("limit")
    return "allowed"
  }
)
const changeOwnEmail = vi.fn()
const sendVerificationEmail = vi.fn()
const revalidatePath = vi.fn()
const getClaims = vi.fn()
const getUser = vi.fn()
const refreshSession = vi.fn()
const profileUpdate = vi.fn()
const afterTasks: (() => unknown)[] = []

vi.mock("next/server", () => ({
  after: (task: () => unknown) => {
    afterTasks.push(task)
  },
}))
vi.mock("next/cache", () => ({
  revalidatePath: (...args: unknown[]) => revalidatePath(...args),
}))
vi.mock("@/lib/rpc", () => ({ callRpc: vi.fn() }))
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
vi.mock("@/lib/server/privileged/account", () => ({
  changeOwnEmail: (...args: unknown[]) => {
    order.push("change")
    return changeOwnEmail(...args)
  },
}))
vi.mock("@/lib/server/privileged/email-auth", () => ({
  sendVerificationEmail: (...args: unknown[]) => sendVerificationEmail(...args),
}))
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getClaims, getUser, refreshSession },
    from: (table: string) => ({
      update: (row: unknown) => ({
        eq: (column: string, value: unknown) => ({
          select: async () => {
            order.push("details")
            return profileUpdate(table, row, column, value)
          },
        }),
      }),
    }),
  }),
}))

const USER = "11111111-1111-4111-8111-111111111111"
const KEY = "22222222-2222-4222-8222-222222222222"

const input = (extra: Partial<Record<string, unknown>> = {}) => ({
  fullName: " Her Name ",
  dietaryNotes: "",
  specialBrunchInterests: [] as string[],
  email: " New@Example.com ",
  confirm: "new@example.com",
  password: "Current-pass-1",
  idempotencyKey: KEY,
  ...extra,
})

// changeOwnEmail as it really runs: the password (passed), then the
// details' write, then the change (its answer given here).
function changeRuns(answer: unknown) {
  changeOwnEmail.mockImplementation(
    async (
      _input: unknown,
      _key: unknown,
      afterPasswordCheck?: () => Promise<{ ok: boolean }>
    ) => {
      const before = await afterPasswordCheck?.()
      if (before && !before.ok) return { ...before, stage: "details" }
      return answer
    }
  )
}

beforeEach(() => {
  order.length = 0
  afterTasks.length = 0
  for (const mock of [
    changeOwnEmail,
    sendVerificationEmail,
    revalidatePath,
    getClaims,
    getUser,
    refreshSession,
    profileUpdate,
  ]) {
    mock.mockReset()
  }
  hitRateLimit.mockClear()
  // The session's claims still carry an older address.
  getClaims.mockResolvedValue({
    data: { claims: { sub: USER, email: "stale@example.com" } },
  })
  getUser.mockResolvedValue({
    data: { user: { id: USER, email: "current@example.com" } },
    error: null,
  })
  refreshSession.mockResolvedValue({ error: null })
  profileUpdate.mockResolvedValue({ data: [{ id: USER }], error: null })
  vi.spyOn(console, "error").mockImplementation(() => {})
})

describe("updateDetailsWithEmailAction", () => {
  it("needs a session, before the limit", async () => {
    getClaims.mockResolvedValue({ data: null })
    await expect(updateDetailsWithEmailAction(input())).resolves.toEqual({
      ok: false,
      code: "NOT_AUTHORIZED",
    })
    expect(hitRateLimit).not.toHaveBeenCalled()
  })

  it("the details' shape first: nothing limited, written or changed", async () => {
    await expect(
      updateDetailsWithEmailAction(input({ fullName: " " }))
    ).resolves.toEqual({
      ok: false,
      code: "FIELD_REQUIRED",
      detail: { field: "full_name" },
    })
    expect(hitRateLimit).not.toHaveBeenCalled()
    expect(changeOwnEmail).not.toHaveBeenCalled()
    expect(profileUpdate).not.toHaveBeenCalled()
  })

  it("limits first, on its own id (change:<user id>)", async () => {
    hitRateLimit.mockResolvedValueOnce("blocked")
    await expect(updateDetailsWithEmailAction(input())).resolves.toEqual({
      ok: false,
      code: "TOO_MANY_ATTEMPTS",
    })
    expect(hitRateLimit).toHaveBeenCalledWith("email", {
      ip: "203.0.113.7",
      id: `change:${USER}`,
    })
    expect(changeOwnEmail).not.toHaveBeenCalled()
    expect(profileUpdate).not.toHaveBeenCalled()
  })

  it.each([
    [{ email: "" }, "FIELD_REQUIRED", "email"],
    [{ email: "not-an-email" }, "INVALID_INPUT", "email"],
    [{ confirm: "other@example.com" }, "EMAILS_DONT_MATCH", "confirm"],
    [{ password: "" }, "FIELD_REQUIRED", "password"],
  ])(
    "refuses %j as %s on %s, without a write or a change",
    async (extra, code, field) => {
      await expect(updateDetailsWithEmailAction(input(extra))).resolves.toEqual(
        { ok: false, code, detail: { field } }
      )
      expect(changeOwnEmail).not.toHaveBeenCalled()
      expect(profileUpdate).not.toHaveBeenCalled()
    }
  )

  it("the password, then the details, then the change; her current Auth address, not the claims", async () => {
    changeRuns({ ok: true, data: undefined })
    await expect(updateDetailsWithEmailAction(input())).resolves.toEqual({
      ok: true,
      data: { email: "new@example.com" },
    })
    expect(changeOwnEmail).toHaveBeenCalledWith(
      {
        userId: USER,
        currentEmail: "current@example.com",
        email: "new@example.com",
        password: "Current-pass-1",
      },
      KEY,
      expect.any(Function)
    )
    expect(order).toEqual(["limit", "change", "details"])
    expect(profileUpdate).toHaveBeenCalledWith(
      "profiles",
      {
        full_name: "Her Name",
        dietary_notes: null,
        special_brunch_interests: [],
      },
      "id",
      USER
    )
    expect(refreshSession).toHaveBeenCalled()
    expect(revalidatePath).toHaveBeenCalledWith("/me/profile")
    // The verification email only after the answer, to her account.
    expect(sendVerificationEmail).not.toHaveBeenCalled()
    for (const task of afterTasks) await task()
    expect(sendVerificationEmail).toHaveBeenCalledWith(USER)
  })

  it("a wrong password: WRONG_PASSWORD and nothing saved", async () => {
    // changeOwnEmail stops before its afterPasswordCheck.
    changeOwnEmail.mockResolvedValue({ ok: false, code: "WRONG_PASSWORD" })
    await expect(updateDetailsWithEmailAction(input())).resolves.toEqual({
      ok: false,
      code: "WRONG_PASSWORD",
    })
    expect(profileUpdate).not.toHaveBeenCalled()
    expect(refreshSession).not.toHaveBeenCalled()
    expect(afterTasks).toEqual([])
  })

  it("the details' write fails: its own answer, no change", async () => {
    changeRuns({ ok: true, data: undefined })
    profileUpdate.mockResolvedValue({ data: [], error: null })
    await expect(updateDetailsWithEmailAction(input())).resolves.toEqual({
      ok: false,
      code: "NOT_AUTHORIZED",
    })
    expect(refreshSession).not.toHaveBeenCalled()
    expect(afterTasks).toEqual([])
  })

  it("EMAIL_TAKEN after the details were saved: passed through, the view reloads", async () => {
    changeRuns({ ok: false, code: "EMAIL_TAKEN" })
    await expect(updateDetailsWithEmailAction(input())).resolves.toEqual({
      ok: false,
      code: "EMAIL_TAKEN",
      detail: { field: "email" },
    })
    expect(profileUpdate).toHaveBeenCalled()
    expect(revalidatePath).toHaveBeenCalledWith("/me/profile")
    expect(refreshSession).not.toHaveBeenCalled()
    expect(afterTasks).toEqual([])
  })

  it.each(["SERVER_ERROR", "ACCOUNT_CHANGE_BLOCKED"])(
    "%s of the email part: on the email field; no refresh, no email",
    async (code) => {
      changeRuns({ ok: false, code })
      await expect(updateDetailsWithEmailAction(input())).resolves.toEqual({
        ok: false,
        code,
        detail: { field: "email" },
      })
      expect(refreshSession).not.toHaveBeenCalled()
      expect(afterTasks).toEqual([])
    }
  )

  it("Auth's user unreadable: SERVER_ERROR before any change", async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: { code: "x" } })
    await expect(updateDetailsWithEmailAction(input())).resolves.toEqual({
      ok: false,
      code: "SERVER_ERROR",
    })
    expect(changeOwnEmail).not.toHaveBeenCalled()
    expect(profileUpdate).not.toHaveBeenCalled()
  })
})
