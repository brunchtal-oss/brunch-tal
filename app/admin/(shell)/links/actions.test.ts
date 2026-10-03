import { beforeEach, describe, expect, it, vi } from "vitest"

import { replaceLinkAction, revokeLinkAction } from "./actions"

const callRpc = vi.fn()
const deleteOrphanUser = vi.fn()
const createServiceClient = vi.fn(() => ({ service: true }))
let requestHeaders = new Headers()

vi.mock("@/lib/rpc", () => ({
  callRpc: (...args: unknown[]) => callRpc(...args),
}))
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ session: true }),
}))
vi.mock("@/lib/server/privileged/service-client", () => ({
  createServiceClient: () => createServiceClient(),
}))
vi.mock("@/lib/server/privileged/join", () => ({
  deleteOrphanUser: (...args: unknown[]) => deleteOrphanUser(...args),
}))
vi.mock("next/headers", () => ({
  headers: async () => requestHeaders,
}))

const TOKEN_ID = "11111111-1111-4111-8111-111111111111"
const PAYMENT_ID = "33333333-3333-4333-8333-333333333333"
const KEY = "22222222-2222-4222-8222-222222222222"
const PENDING_USER = "44444444-4444-4444-8444-444444444444"
const NEW_TOKEN_ID = "55555555-5555-4555-8555-555555555555"
const TOKEN = "t".repeat(43)
const EXPIRES = "2026-10-05T09:00:00+00:00"

beforeEach(() => {
  callRpc.mockReset()
  deleteOrphanUser.mockReset()
  deleteOrphanUser.mockResolvedValue(true)
  createServiceClient.mockClear()
  requestHeaders = new Headers({ origin: "https://host.example" })
})

describe("revokeLinkAction", () => {
  it("revokes with the admin's session and the page's key", async () => {
    callRpc.mockResolvedValue({
      ok: true,
      data: { token_id: TOKEN_ID, revoked_pending_user_id: null },
    })
    await expect(
      revokeLinkAction({ tokenId: TOKEN_ID, idempotencyKey: KEY })
    ).resolves.toEqual({ ok: true, data: undefined })
    expect(callRpc).toHaveBeenCalledWith(
      { session: true },
      "admin_revoke_link",
      { p_token_id: TOKEN_ID, p_idempotency_key: KEY }
    )
    expect(deleteOrphanUser).not.toHaveBeenCalled()
    expect(createServiceClient).not.toHaveBeenCalled()
  })

  it("deletes the pending Auth user the RPC returned", async () => {
    callRpc.mockResolvedValue({
      ok: true,
      data: { token_id: TOKEN_ID, revoked_pending_user_id: PENDING_USER },
    })
    await revokeLinkAction({ tokenId: TOKEN_ID, idempotencyKey: KEY })
    expect(deleteOrphanUser).toHaveBeenCalledWith(
      { service: true },
      PENDING_USER,
      TOKEN_ID
    )
  })

  it.each(["LINK_USED", "LINK_IN_PROGRESS", "NOT_AUTHORIZED"])(
    "passes %s through without deleting anything",
    async (code) => {
      callRpc.mockResolvedValue({ ok: false, code })
      await expect(
        revokeLinkAction({ tokenId: TOKEN_ID, idempotencyKey: KEY })
      ).resolves.toEqual({ ok: false, code })
      expect(deleteOrphanUser).not.toHaveBeenCalled()
    }
  )

  it("refuses ids that are not uuids without calling the RPC", async () => {
    await expect(
      revokeLinkAction({ tokenId: "x", idempotencyKey: KEY })
    ).resolves.toEqual({ ok: false, code: "INVALID_INPUT" })
    expect(callRpc).not.toHaveBeenCalled()
  })
})

describe("replaceLinkAction", () => {
  it("issues a join link for the payment and builds it from the Origin", async () => {
    callRpc.mockResolvedValue({
      ok: true,
      data: {
        token_id: NEW_TOKEN_ID,
        token: TOKEN,
        link_expires_at: EXPIRES,
        revoked_pending_user_id: PENDING_USER,
      },
    })
    await expect(
      replaceLinkAction({ paymentId: PAYMENT_ID, idempotencyKey: KEY })
    ).resolves.toEqual({
      ok: true,
      data: {
        link: `https://host.example/join/${TOKEN}`,
        linkExpiresAt: EXPIRES,
      },
    })
    expect(callRpc).toHaveBeenCalledWith(
      { session: true },
      "admin_issue_link",
      {
        p_purpose: "join",
        p_target_id: PAYMENT_ID,
        p_idempotency_key: KEY,
      }
    )
    expect(deleteOrphanUser).toHaveBeenCalledWith(
      { service: true },
      PENDING_USER,
      NEW_TOKEN_ID
    )
  })

  it("has no link for a repeat with the same key (reissue_required)", async () => {
    callRpc.mockResolvedValue({
      ok: true,
      data: {
        token_id: NEW_TOKEN_ID,
        link_expires_at: EXPIRES,
        revoked_pending_user_id: null,
        reissue_required: true,
      },
    })
    await expect(
      replaceLinkAction({ paymentId: PAYMENT_ID, idempotencyKey: KEY })
    ).resolves.toEqual({
      ok: true,
      data: { link: null, linkExpiresAt: EXPIRES },
    })
  })

  it("passes LINK_IN_PROGRESS through", async () => {
    callRpc.mockResolvedValue({ ok: false, code: "LINK_IN_PROGRESS" })
    await expect(
      replaceLinkAction({ paymentId: PAYMENT_ID, idempotencyKey: KEY })
    ).resolves.toEqual({ ok: false, code: "LINK_IN_PROGRESS" })
  })
})
