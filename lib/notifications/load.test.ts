import { beforeEach, describe, expect, it, vi } from "vitest"

import {
  loadNotifications,
  loadUnreadCount,
  markNotificationsRead,
  markNotificationsUnread,
} from "./load"

const callRpc = vi.fn()
let query: ReturnType<typeof makeQuery>
const from = vi.fn(() => query)

vi.mock("@/lib/rpc", () => ({
  callRpc: (...args: unknown[]) => callRpc(...args),
}))
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ session: true, from }),
}))

const ID = "8f2b2c1e-1a2b-4c3d-9e8f-0a1b2c3d4e5f"

// A chainable query builder that records each call and resolves to `result`.
function makeQuery(result: unknown) {
  const calls: Array<[string, unknown[]]> = []
  const builder: Record<string, unknown> = {}
  for (const name of ["select", "eq", "is", "order", "limit"]) {
    builder[name] = (...args: unknown[]) => {
      calls.push([name, args])
      return builder
    }
  }
  builder.then = (resolve: (value: unknown) => unknown) => resolve(result)
  return { builder, calls }
}

function useQuery(result: unknown) {
  const made = makeQuery(result)
  query = made
  from.mockImplementation(() => made.builder as never)
  return made.calls
}

beforeEach(() => {
  callRpc.mockReset()
  from.mockReset()
})

describe("markNotificationsRead", () => {
  it("marks all with no ids", async () => {
    callRpc.mockResolvedValue({ ok: true, data: { marked: 3 } })
    await expect(markNotificationsRead(null)).resolves.toEqual({
      ok: true,
      data: { marked: 3 },
    })
    expect(callRpc).toHaveBeenCalledWith(
      expect.objectContaining({ session: true }),
      "mark_notifications_read",
      {}
    )
  })

  it("passes the given ids", async () => {
    callRpc.mockResolvedValue({ ok: true, data: { marked: 1 } })
    await markNotificationsRead([ID])
    expect(callRpc).toHaveBeenCalledWith(
      expect.anything(),
      "mark_notifications_read",
      { p_ids: [ID] }
    )
  })

  it("passes an RPC error through", async () => {
    callRpc.mockResolvedValue({ ok: false, code: "NOT_AUTHORIZED" })
    await expect(markNotificationsRead([ID])).resolves.toEqual({
      ok: false,
      code: "NOT_AUTHORIZED",
    })
  })
})

describe("markNotificationsUnread", () => {
  it.each([[null], [[]], [["x"]]])(
    "refuses %j without calling the RPC",
    async (ids) => {
      await expect(markNotificationsUnread(ids)).resolves.toEqual({
        ok: false,
        code: "INVALID_INPUT",
      })
      expect(callRpc).not.toHaveBeenCalled()
    }
  )

  it("returns what the RPC marked", async () => {
    callRpc.mockResolvedValue({ ok: true, data: { marked: 3 } })
    await expect(markNotificationsUnread([ID])).resolves.toEqual({
      ok: true,
      data: { marked: 3 },
    })
    expect(callRpc).toHaveBeenCalledWith(
      expect.anything(),
      "mark_notifications_unread",
      { p_ids: [ID] }
    )
  })

  it("passes an RPC error through", async () => {
    callRpc.mockResolvedValue({ ok: false, code: "SERVER_ERROR" })
    await expect(markNotificationsUnread([ID])).resolves.toEqual({
      ok: false,
      code: "SERVER_ERROR",
    })
  })
})

describe("loadNotifications", () => {
  it("reads the surface's own kind, newest first", async () => {
    const calls = useQuery({
      data: [
        {
          id: ID,
          payload: { title: "t", body: "b" },
          target_path: "/me",
          created_at: "2026-10-06T05:15:00Z",
          read_at: null,
        },
      ],
      error: null,
    })
    await expect(loadNotifications("admin")).resolves.toEqual([
      {
        id: ID,
        title: "t",
        body: "b",
        targetPath: "/me",
        createdAt: "2026-10-06T05:15:00Z",
        read: false,
      },
    ])
    expect(from).toHaveBeenCalledWith("notifications")
    expect(calls).toContainEqual(["eq", ["recipient_kind", "admin"]])
    expect(calls).toContainEqual([
      "order",
      ["created_at", { ascending: false }],
    ])
  })
})

describe("loadUnreadCount", () => {
  it("counts the surface's unread", async () => {
    const calls = useQuery({ count: 4, error: null })
    await expect(loadUnreadCount("customer")).resolves.toBe(4)
    expect(calls).toContainEqual(["eq", ["recipient_kind", "customer"]])
    expect(calls).toContainEqual(["is", ["read_at", null]])
  })

  it("is null when the query fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    useQuery({ count: null, error: { code: "XX000" } })
    await expect(loadUnreadCount("customer")).resolves.toBeNull()
  })
})
