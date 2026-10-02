import { beforeEach, describe, expect, it, vi } from "vitest"

import { getJoinTokenView, submitJoin, type JoinInput } from "./join"

const rpc = vi.fn()
// token_view inside submitJoin (the guard before a password update) is routed
// here; getJoinTokenView's own calls fall through to rpc.
const tokenView = vi.fn()
const getUserById = vi.fn()
const updateUserById = vi.fn()
const createUser = vi.fn()
const deleteUser = vi.fn()

vi.mock("@/lib/server/privileged/service-client", () => ({
  createServiceClient: () => ({
    rpc: (name: string, args: unknown) =>
      name === "token_view" ? tokenView(name, args) : rpc(name, args),
    auth: { admin: { getUserById, updateUserById, createUser, deleteUser } },
  }),
}))

const TOKEN = "t".repeat(43)
const KEY = "22222222-2222-4222-8222-222222222222"
const USER_ID = "11111111-1111-4111-8111-111111111111"
const PASSWORD = "Test-pass-123"
const p0001 = (code: string, details?: string) => ({
  code: "P0001",
  message: code,
  details,
})

const INPUT: JoinInput = {
  email: " Dev-Join@Example.com ",
  phone: "054-1234567",
  password: PASSWORD,
  fullName: "Dev Join",
  dietaryNotes: null,
  privacyConsent: true,
  photoConsent: false,
  babies: [{ name: "Baby", birthDate: "2026-09-01" }],
}

const claiming = {
  data: { outcome: "claiming", token_id: "tok-1", pending_user_id: USER_ID },
  error: null,
}
const joined = {
  data: { outcome: "joined", token_id: "tok-1", customer_id: USER_ID },
  error: null,
}
const notFound = {
  data: { user: null },
  error: { status: 404, code: "user_not_found", message: "x" },
}
const found = { data: { user: { id: USER_ID } }, error: null }
const ok = { data: { user: { id: USER_ID } }, error: null }

function rpcNames() {
  return rpc.mock.calls.map(([name]) => name)
}

beforeEach(() => {
  for (const fn of [
    rpc,
    tokenView,
    getUserById,
    updateUserById,
    createUser,
    deleteUser,
  ]) {
    fn.mockReset()
  }
  deleteUser.mockResolvedValue({ data: { user: null }, error: null })
  tokenView.mockImplementation((name: string, args: unknown) => rpc(name, args))
  vi.spyOn(console, "error").mockImplementation(() => {})
})

describe("getJoinTokenView", () => {
  const view = (state_public: string, purpose: string | null = "join") => ({
    data: {
      state_public,
      purpose,
      product_name: ["active", "awaiting_login"].includes(state_public)
        ? "Card"
        : null,
      amount_agorot: ["active", "awaiting_login"].includes(state_public)
        ? 47200
        : null,
      bound_user_id: state_public === "awaiting_login" ? USER_ID : null,
    },
    error: null,
  })

  it("returns the product of an active join link", async () => {
    rpc.mockResolvedValue(view("active"))
    await expect(getJoinTokenView(TOKEN)).resolves.toEqual({
      state: "active",
      productName: "Card",
      amountAgorot: 47200,
      conflictReason: null,
      boundUserId: null,
    })
    expect(rpc).toHaveBeenCalledWith("token_view", { p_token: TOKEN })
  })

  it("returns the product of a link waiting for an existing account", async () => {
    rpc.mockResolvedValue(view("awaiting_login"))
    await expect(getJoinTokenView(TOKEN)).resolves.toEqual({
      state: "awaiting_login",
      productName: "Card",
      amountAgorot: 47200,
      conflictReason: null,
      boundUserId: USER_ID,
    })
  })

  it("keeps the bound account only for an awaiting_login link", async () => {
    for (const state of ["active", "used", "conflict", "expired"]) {
      rpc.mockResolvedValue({
        data: {
          state_public: state,
          purpose: "join",
          product_name: null,
          amount_agorot: null,
          bound_user_id: USER_ID,
        },
        error: null,
      })
      await expect(getJoinTokenView(TOKEN)).resolves.toMatchObject({
        boundUserId: null,
      })
    }
    rpc.mockResolvedValue({
      data: {
        state_public: "awaiting_login",
        purpose: "join",
        product_name: "Card",
        amount_agorot: 47200,
      },
      error: null,
    })
    await expect(getJoinTokenView(TOKEN)).resolves.toMatchObject({
      boundUserId: null,
    })
  })

  it.each([
    ["two_accounts", "two_accounts"],
    ["bind_conflict", "bind_conflict"],
    [null, null],
    ["identity_match", null],
  ])(
    "returns the stored reason %j of a conflict link",
    async (reason, expected) => {
      rpc.mockResolvedValue({
        data: {
          state_public: "conflict",
          purpose: "join",
          product_name: null,
          amount_agorot: null,
          conflict_reason: reason,
        },
        error: null,
      })
      await expect(getJoinTokenView(TOKEN)).resolves.toEqual({
        state: "conflict",
        productName: null,
        amountAgorot: null,
        conflictReason: expected,
        boundUserId: null,
      })
    }
  )

  it.each([
    ["used", "used"],
    ["conflict", "conflict"],
    ["expired", "expired"],
    ["not_found", "expired"],
  ])("maps %s to %s", async (statePublic, expected) => {
    rpc.mockResolvedValue(
      view(statePublic, statePublic === "not_found" ? null : "join")
    )
    await expect(getJoinTokenView(TOKEN)).resolves.toMatchObject({
      state: expected,
    })
  })

  it.each(["reset", "claim"])(
    "treats an active %s link as expired",
    async (purpose) => {
      rpc.mockResolvedValue(view("active", purpose))
      await expect(getJoinTokenView(TOKEN)).resolves.toEqual({
        state: "expired",
        productName: null,
        amountAgorot: null,
        conflictReason: null,
        boundUserId: null,
      })
    }
  )
})

describe("submitJoin", () => {
  beforeEach(() => {
    tokenView.mockResolvedValue({
      data: { state_public: "active", purpose: "join" },
      error: null,
    })
  })

  it("does not change the password once a parallel submission consumed the link", async () => {
    rpc.mockImplementation(async (name: string) =>
      name === "join_begin"
        ? claiming
        : { data: null, error: p0001("LINK_USED") }
    )
    tokenView.mockResolvedValue({
      data: { state_public: "used", purpose: "join" },
      error: null,
    })
    getUserById.mockResolvedValue(found)

    await expect(submitJoin(TOKEN, INPUT, KEY)).resolves.toEqual({
      ok: false,
      code: "LINK_USED",
    })
    expect(tokenView).toHaveBeenCalledWith("token_view", { p_token: TOKEN })
    expect(updateUserById).not.toHaveBeenCalled()
    expect(rpcNames()).toEqual(["join_begin", "join_complete"])
  })

  it("creates a new Auth user with the pending id, then completes", async () => {
    const order: string[] = []
    rpc.mockImplementation(async (name: string) => {
      order.push(name)
      return name === "join_begin" ? claiming : joined
    })
    getUserById.mockImplementation(async () => {
      order.push("getUserById")
      return notFound
    })
    createUser.mockImplementation(async () => {
      order.push("createUser")
      return ok
    })

    await expect(submitJoin(TOKEN, INPUT, KEY)).resolves.toEqual({
      ok: true,
      data: { outcome: "joined", email: "dev-join@example.com" },
    })
    expect(order).toEqual([
      "join_begin",
      "getUserById",
      "createUser",
      "join_complete",
    ])
    expect(rpc).toHaveBeenCalledWith("join_begin", {
      p_token: TOKEN,
      p_email: INPUT.email,
      p_phone: INPUT.phone,
      p_idempotency_key: KEY,
    })
    expect(createUser).toHaveBeenCalledWith({
      id: USER_ID,
      email: "dev-join@example.com",
      password: PASSWORD,
      email_confirm: true,
    })
    expect(rpc).toHaveBeenCalledWith("join_complete", {
      p_token: TOKEN,
      p_profile: {
        email: INPUT.email,
        phone: INPUT.phone,
        full_name: "Dev Join",
        dietary_notes: null,
        privacy_consent: true,
        photo_consent: false,
        babies: [{ name: "Baby", birth_date: "2026-09-01" }],
      },
      p_idempotency_key: KEY,
    })
    expect(updateUserById).not.toHaveBeenCalled()
  })

  it("sets the password of an existing pending user instead of creating one (retry after a failure)", async () => {
    rpc.mockImplementation(async (name: string) =>
      name === "join_begin" ? claiming : joined
    )
    getUserById.mockResolvedValue(found)
    updateUserById.mockResolvedValue(ok)

    await expect(submitJoin(TOKEN, INPUT, KEY)).resolves.toMatchObject({
      ok: true,
      data: { outcome: "joined" },
    })
    expect(updateUserById).toHaveBeenCalledWith(USER_ID, {
      password: PASSWORD,
    })
    expect(createUser).not.toHaveBeenCalled()
  })

  it("continues with the user a parallel submission created (create fails, the id now exists)", async () => {
    rpc.mockImplementation(async (name: string) =>
      name === "join_begin" ? claiming : joined
    )
    getUserById.mockResolvedValueOnce(notFound).mockResolvedValueOnce(found)
    createUser.mockResolvedValue({
      data: { user: null },
      error: { status: 422, code: "email_exists", message: "x" },
    })
    updateUserById.mockResolvedValue(ok)

    await expect(submitJoin(TOKEN, INPUT, KEY)).resolves.toMatchObject({
      ok: true,
      data: { outcome: "joined" },
    })
    expect(updateUserById).toHaveBeenCalledTimes(1)
    expect(rpcNames()).toEqual(["join_begin", "join_complete"])
  })

  it("answers conflict when the email belongs to another Auth user, without completing", async () => {
    rpc.mockResolvedValue(claiming)
    getUserById.mockResolvedValue(notFound)
    createUser.mockResolvedValue({
      data: { user: null },
      error: { status: 422, code: "email_exists", message: "x" },
    })

    await expect(submitJoin(TOKEN, INPUT, KEY)).resolves.toEqual({
      ok: true,
      data: { outcome: "conflict", reason: "email_exists" },
    })
    expect(rpcNames()).toEqual(["join_begin"])
  })

  it("maps a weak password to PASSWORD_TOO_SHORT", async () => {
    rpc.mockResolvedValue(claiming)
    getUserById.mockResolvedValue(notFound)
    createUser.mockResolvedValue({
      data: { user: null },
      error: { status: 422, code: "weak_password", message: "x" },
    })

    await expect(submitJoin(TOKEN, INPUT, KEY)).resolves.toEqual({
      ok: false,
      code: "PASSWORD_TOO_SHORT",
    })
    expect(rpcNames()).toEqual(["join_begin"])
  })

  it("returns SERVER_ERROR when complete fails, and a retry with the same key completes once", async () => {
    let completeCalls = 0
    rpc.mockImplementation(async (name: string) => {
      if (name === "join_begin") return claiming
      completeCalls++
      return completeCalls === 1
        ? { data: null, error: { code: "PGRST000", message: "network" } }
        : joined
    })
    // First attempt creates the user; the retry finds it.
    getUserById.mockResolvedValueOnce(notFound).mockResolvedValue(found)
    createUser.mockResolvedValue(ok)
    updateUserById.mockResolvedValue(ok)

    await expect(submitJoin(TOKEN, INPUT, KEY)).resolves.toEqual({
      ok: false,
      code: "SERVER_ERROR",
    })
    await expect(submitJoin(TOKEN, INPUT, KEY)).resolves.toMatchObject({
      ok: true,
      data: { outcome: "joined" },
    })
    expect(createUser).toHaveBeenCalledTimes(1)
    expect(updateUserById).toHaveBeenCalledTimes(1)
    expect(completeCalls).toBe(2)
  })

  it("skips Auth when begin answers that this key already joined (lost response)", async () => {
    rpc.mockResolvedValue({
      data: { outcome: "joined", token_id: "tok-1", customer_id: USER_ID },
      error: null,
    })

    await expect(submitJoin(TOKEN, INPUT, KEY)).resolves.toEqual({
      ok: true,
      data: { outcome: "joined", email: "dev-join@example.com" },
    })
    expect(getUserById).not.toHaveBeenCalled()
    expect(rpcNames()).toEqual(["join_begin"])
  })

  it("returns a begin conflict without touching Auth", async () => {
    rpc.mockResolvedValue({
      data: { outcome: "conflict", token_id: "tok-1", reason: "two_accounts" },
      error: null,
    })
    await expect(submitJoin(TOKEN, INPUT, KEY)).resolves.toEqual({
      ok: true,
      data: { outcome: "conflict", reason: "two_accounts" },
    })
    expect(getUserById).not.toHaveBeenCalled()
  })

  it("returns identity_retry without touching Auth", async () => {
    rpc.mockResolvedValue({
      data: { outcome: "identity_retry", token_id: "tok-1" },
      error: null,
    })
    await expect(submitJoin(TOKEN, INPUT, KEY)).resolves.toEqual({
      ok: true,
      data: { outcome: "identity_retry" },
    })
    expect(getUserById).not.toHaveBeenCalled()
    expect(rpcNames()).toEqual(["join_begin"])
  })

  it.each([
    ["not_activated", "not_activated"],
    [undefined, null],
    ["something_else", null],
  ])("passes the begin conflict reason %j as %j", async (reason, expected) => {
    rpc.mockResolvedValue({
      data: { outcome: "conflict", token_id: "tok-1", reason },
      error: null,
    })
    await expect(submitJoin(TOKEN, INPUT, KEY)).resolves.toEqual({
      ok: true,
      data: { outcome: "conflict", reason: expected },
    })
  })

  it("returns existing_account without touching Auth", async () => {
    rpc.mockResolvedValue({
      data: { outcome: "existing_account", token_id: "tok-1" },
      error: null,
    })
    await expect(submitJoin(TOKEN, INPUT, KEY)).resolves.toEqual({
      ok: true,
      data: { outcome: "existing_account" },
    })
    expect(getUserById).not.toHaveBeenCalled()
    expect(createUser).not.toHaveBeenCalled()
    expect(rpcNames()).toEqual(["join_begin"])
  })

  it("returns a complete conflict (phone taken or BIND_CONFLICT) and deletes the orphan Auth user", async () => {
    rpc.mockImplementation(async (name: string) =>
      name === "join_begin"
        ? claiming
        : {
            data: {
              outcome: "conflict",
              token_id: "tok-1",
              reason: "phone_taken",
            },
            error: null,
          }
    )
    getUserById.mockResolvedValue(found)
    updateUserById.mockResolvedValue(ok)
    await expect(submitJoin(TOKEN, INPUT, KEY)).resolves.toEqual({
      ok: true,
      data: { outcome: "conflict", reason: "phone_taken" },
    })
    expect(deleteUser).toHaveBeenCalledWith(USER_ID)
    expect(console.error).not.toHaveBeenCalled()
  })

  it("does not delete any Auth user for a begin conflict or an email that exists", async () => {
    rpc.mockResolvedValue({
      data: { outcome: "conflict", token_id: "tok-1" },
      error: null,
    })
    await submitJoin(TOKEN, INPUT, KEY)

    rpc.mockResolvedValue(claiming)
    getUserById.mockResolvedValue(notFound)
    createUser.mockResolvedValue({
      data: { user: null },
      error: { status: 422, code: "email_exists", message: "x" },
    })
    await submitJoin(TOKEN, INPUT, KEY)

    expect(deleteUser).not.toHaveBeenCalled()
  })

  it.each([
    [
      "an Auth error",
      async () => ({
        data: { user: null },
        error: { status: 500, code: "unexpected_failure", message: "x" },
      }),
      "unexpected_failure",
    ],
    [
      "a thrown request",
      async () => {
        throw new Error("fetch failed")
      },
      "exception",
    ],
  ])(
    "keeps the conflict when deleting the orphan fails (%s), logging only ids and codes",
    async (_label, failure, authCode) => {
      rpc.mockImplementation(async (name: string) =>
        name === "join_begin"
          ? claiming
          : {
              data: {
                outcome: "conflict",
                token_id: "tok-1",
                reason: "phone_taken",
              },
              error: null,
            }
      )
      getUserById.mockResolvedValue(found)
      updateUserById.mockResolvedValue(ok)
      deleteUser.mockImplementation(failure)

      await expect(submitJoin(TOKEN, INPUT, KEY)).resolves.toEqual({
        ok: true,
        data: { outcome: "conflict", reason: "phone_taken" },
      })
      expect(console.error).toHaveBeenCalledWith("join.delete_orphan_failed", {
        tokenId: "tok-1",
        authCode,
      })
    }
  )

  it("treats an orphan that is already gone as deleted", async () => {
    rpc.mockImplementation(async (name: string) =>
      name === "join_begin"
        ? claiming
        : {
            data: {
              outcome: "conflict",
              token_id: "tok-1",
              reason: "phone_taken",
            },
            error: null,
          }
    )
    getUserById.mockResolvedValue(found)
    updateUserById.mockResolvedValue(ok)
    deleteUser.mockResolvedValue({
      data: { user: null },
      error: { status: 404, code: "user_not_found", message: "x" },
    })
    await submitJoin(TOKEN, INPUT, KEY)
    expect(console.error).not.toHaveBeenCalled()
  })

  it.each(["LINK_USED", "LINK_EXPIRED", "LINK_IN_USE"])(
    "passes begin %s through without touching Auth",
    async (code) => {
      rpc.mockResolvedValue({ data: null, error: p0001(code) })
      await expect(submitJoin(TOKEN, INPUT, KEY)).resolves.toEqual({
        ok: false,
        code,
      })
      expect(getUserById).not.toHaveBeenCalled()
    }
  )

  it("passes the field of an INVALID_INPUT through", async () => {
    rpc.mockResolvedValue({
      data: null,
      error: p0001("INVALID_INPUT", '{"field": "phone"}'),
    })
    await expect(submitJoin(TOKEN, INPUT, KEY)).resolves.toEqual({
      ok: false,
      code: "INVALID_INPUT",
      detail: { field: "phone" },
    })
  })

  it("never logs the token, password, email, phone or name", async () => {
    rpc.mockResolvedValue(claiming)
    getUserById.mockResolvedValue(notFound)
    createUser.mockResolvedValue({
      data: { user: null },
      error: { status: 500, code: "unexpected_failure", message: "x" },
    })

    await submitJoin(TOKEN, INPUT, KEY)

    const logged = JSON.stringify(vi.mocked(console.error).mock.calls)
    expect(console.error).toHaveBeenCalled()
    for (const secret of [
      TOKEN,
      KEY,
      PASSWORD,
      "example.com",
      "1234567",
      "Dev Join",
    ]) {
      expect(logged).not.toContain(secret)
    }
  })
})
