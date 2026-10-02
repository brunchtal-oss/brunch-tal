import { beforeEach, describe, expect, it, vi } from "vitest"

import { getJoinTokenView, submitJoin, type JoinInput } from "./join"

const rpc = vi.fn()
// token_view inside submitJoin (the guard before a password update) is routed
// here; getJoinTokenView's own calls fall through to rpc.
const tokenView = vi.fn()
const getUserById = vi.fn()
const updateUserById = vi.fn()
const createUser = vi.fn()

vi.mock("@/lib/server/privileged/service-client", () => ({
  createServiceClient: () => ({
    rpc: (name: string, args: unknown) =>
      name === "token_view" ? tokenView(name, args) : rpc(name, args),
    auth: { admin: { getUserById, updateUserById, createUser } },
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
  for (const fn of [rpc, tokenView, getUserById, updateUserById, createUser]) {
    fn.mockReset()
  }
  tokenView.mockImplementation((name: string, args: unknown) => rpc(name, args))
  vi.spyOn(console, "error").mockImplementation(() => {})
})

describe("getJoinTokenView", () => {
  const view = (state_public: string, purpose: string | null = "join") => ({
    data: {
      state_public,
      purpose,
      product_name: state_public === "active" ? "Card" : null,
      amount_agorot: state_public === "active" ? 47200 : null,
    },
    error: null,
  })

  it("returns the product of an active join link", async () => {
    rpc.mockResolvedValue(view("active"))
    await expect(getJoinTokenView(TOKEN)).resolves.toEqual({
      state: "active",
      productName: "Card",
      amountAgorot: 47200,
    })
    expect(rpc).toHaveBeenCalledWith("token_view", { p_token: TOKEN })
  })

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
      data: { outcome: "conflict" },
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
      data: { outcome: "conflict", token_id: "tok-1" },
      error: null,
    })
    await expect(submitJoin(TOKEN, INPUT, KEY)).resolves.toEqual({
      ok: true,
      data: { outcome: "conflict" },
    })
    expect(getUserById).not.toHaveBeenCalled()
  })

  it("returns a complete conflict (phone taken or BIND_CONFLICT)", async () => {
    rpc.mockImplementation(async (name: string) =>
      name === "join_begin"
        ? claiming
        : { data: { outcome: "conflict", token_id: "tok-1" }, error: null }
    )
    getUserById.mockResolvedValue(found)
    updateUserById.mockResolvedValue(ok)
    await expect(submitJoin(TOKEN, INPUT, KEY)).resolves.toEqual({
      ok: true,
      data: { outcome: "conflict" },
    })
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
