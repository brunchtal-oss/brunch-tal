import { beforeEach, describe, expect, it, vi } from "vitest"

const from = vi.fn()
const select = vi.fn()
const eq = vi.fn()
const order = vi.fn()
const limit = vi.fn()
const maybeSingle = vi.fn()

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ from }),
}))

const { loadLatestReminder } = await import("./load-home")

beforeEach(() => {
  for (const fn of [from, select, eq, order, limit, maybeSingle]) {
    fn.mockReset()
  }
  const chain = { select, eq, order, limit, maybeSingle }
  for (const fn of [from, select, eq, order, limit]) fn.mockReturnValue(chain)
})

describe("loadLatestReminder (story 5.11)", () => {
  it("reads her newest marketing reminder, one row", async () => {
    const row = { id: "n1", payload: { body: "x" }, read_at: null }
    maybeSingle.mockResolvedValue({ data: row, error: null })
    await expect(loadLatestReminder()).resolves.toEqual(row)
    expect(from).toHaveBeenCalledWith("notifications")
    expect(select).toHaveBeenCalledWith("id, payload, read_at")
    expect(eq).toHaveBeenCalledWith("recipient_kind", "admin")
    expect(eq).toHaveBeenCalledWith("type", "marketing_reminder")
    expect(order).toHaveBeenNthCalledWith(1, "created_at", {
      ascending: false,
    })
    expect(order).toHaveBeenNthCalledWith(2, "id", { ascending: false })
    expect(limit).toHaveBeenCalledWith(1)
  })

  it("none: null", async () => {
    maybeSingle.mockResolvedValue({ data: null, error: null })
    await expect(loadLatestReminder()).resolves.toBeNull()
  })

  it("a failed read: null, so the strip shows nothing", async () => {
    maybeSingle.mockResolvedValue({
      data: null,
      error: { message: "boom" },
    })
    await expect(loadLatestReminder()).resolves.toBeNull()
  })
})
