import { beforeEach, describe, expect, it, vi } from "vitest"

import { listCustomersAction } from "./actions"

const callRpc = vi.fn()

vi.mock("@/lib/rpc", () => ({
  callRpc: (...args: unknown[]) => callRpc(...args),
}))
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ session: true }),
}))

const LIST = { customers: [], has_more: false }

beforeEach(() => {
  callRpc.mockReset()
  callRpc.mockResolvedValue({ ok: true, data: LIST })
})

describe("the live search and category action (stories 4.2, 5.13)", () => {
  it("sends the trimmed query and the category to admin_list_customers", async () => {
    await expect(listCustomersAction("  רונ ", "all")).resolves.toEqual({
      ok: true,
      data: LIST,
    })
    expect(callRpc).toHaveBeenLastCalledWith(
      { session: true },
      "admin_list_customers",
      { p_query: "רונ", p_activity: "all", p_interests: [] }
    )
    await listCustomersAction("רונ", "inactive")
    expect(callRpc).toHaveBeenLastCalledWith(
      { session: true },
      "admin_list_customers",
      { p_query: "רונ", p_activity: "inactive", p_interests: [] }
    )
  })

  it("an empty query lists the whole category", async () => {
    for (const activity of ["all", "active", "inactive"] as const) {
      await listCustomersAction("  ", activity)
      expect(callRpc).toHaveBeenLastCalledWith(
        { session: true },
        "admin_list_customers",
        { p_query: "", p_activity: activity, p_interests: [] }
      )
    }
  })

  // Story 2.16: the special brunches, sent as p_interests in code order; an
  // unknown or repeated one is refused without the RPC.
  it("sends the special-brunch filter", async () => {
    await listCustomersAction("", "inactive", ["grandpa", "grandma"])
    expect(callRpc).toHaveBeenLastCalledWith(
      { session: true },
      "admin_list_customers",
      {
        p_query: "",
        p_activity: "inactive",
        p_interests: ["grandma", "grandpa"],
      }
    )
    callRpc.mockClear()
    for (const bad of [["aunt"], ["couples", "couples"]]) {
      await expect(listCustomersAction("", "all", bad)).resolves.toEqual({
        ok: false,
        code: "INVALID_INPUT",
      })
    }
    await expect(
      listCustomersAction("", "all", "couples" as unknown as string[])
    ).resolves.toEqual({ ok: false, code: "INVALID_INPUT" })
    expect(callRpc).not.toHaveBeenCalled()
  })

  it("a 1-character query is an empty list, without the RPC", async () => {
    for (const query of ["ר", " ר "]) {
      await expect(listCustomersAction(query, "all")).resolves.toEqual({
        ok: true,
        data: { customers: [], has_more: false },
      })
    }
    expect(callRpc).not.toHaveBeenCalled()
  })

  it("refuses a bad shape", async () => {
    for (const query of [null, 5, "x".repeat(101)]) {
      await expect(
        listCustomersAction(query as unknown as string, "active")
      ).resolves.toEqual({ ok: false, code: "INVALID_INPUT" })
    }
    for (const activity of ["bogus", "", null, undefined]) {
      await expect(
        listCustomersAction("רונ", activity as unknown as "active")
      ).resolves.toEqual({ ok: false, code: "INVALID_INPUT" })
    }
    expect(callRpc).not.toHaveBeenCalled()
  })

  it("passes an RPC failure through", async () => {
    callRpc.mockResolvedValueOnce({ ok: false, code: "NOT_AUTHORIZED" })
    await expect(listCustomersAction("רונ", "active")).resolves.toEqual({
      ok: false,
      code: "NOT_AUTHORIZED",
    })
  })
})
