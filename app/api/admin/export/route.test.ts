import { beforeEach, describe, expect, it, vi } from "vitest"

import { GET } from "./route"

const callRpc = vi.fn()
const getClaims = vi.fn()

vi.mock("@/lib/rpc", () => ({
  callRpc: (...args: unknown[]) => callRpc(...args),
}))
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getClaims } }),
}))
vi.mock("@/lib/time", () => ({ localToday: () => "2026-10-13" }))

const BOM = "\uFEFF"

function get(query: string): Promise<Response> {
  return GET(new Request(`http://localhost/api/admin/export?${query}`))
}

beforeEach(() => {
  callRpc.mockReset()
  getClaims.mockReset()
  getClaims.mockResolvedValue({ data: { claims: { sub: "admin" } } })
})

describe("GET /api/admin/export", () => {
  it("returns the CSV with its headers", async () => {
    callRpc.mockResolvedValue({
      ok: true,
      data: {
        rows: [
          {
            full_name: "=1+1",
            phone_e164: "+972541234567",
            email: null,
          },
        ],
      },
    })
    const response = await get("scope=search&q=%20רונ%20&cols=full_name,phone")
    expect(response.status).toBe(200)
    expect(response.headers.get("content-type")).toBe("text/csv; charset=utf-8")
    expect(response.headers.get("content-disposition")).toBe(
      'attachment; filename="customers-2026-10-13.csv"'
    )
    expect(response.headers.get("cache-control")).toBe("private, no-store")
    // Response.text() drops a leading BOM, so read the bytes.
    const text = new TextDecoder("utf-8", { ignoreBOM: true }).decode(
      await response.arrayBuffer()
    )
    expect(text).toBe(`${BOM}"שם","טלפון"\r\n"'=1+1","054-123-4567"\r\n`)
    expect(callRpc).toHaveBeenCalledWith(
      expect.anything(),
      "admin_export_customers",
      { p_scope: "search", p_query: "רונ", p_columns: ["full_name", "phone"] }
    )
  })

  it("scope=all sends an empty query and the three columns in file order", async () => {
    callRpc.mockResolvedValue({ ok: true, data: { rows: [] } })
    const response = await get("scope=all&cols=email,full_name,phone")
    expect(response.status).toBe(200)
    expect(callRpc).toHaveBeenCalledWith(
      expect.anything(),
      "admin_export_customers",
      {
        p_scope: "all",
        p_query: "",
        p_columns: ["full_name", "phone", "email"],
      }
    )
    const text = new TextDecoder("utf-8", { ignoreBOM: true }).decode(
      await response.arrayBuffer()
    )
    expect(text).toBe(`${BOM}"שם","טלפון","מייל"\r\n`)
  })

  it("no session -> 403 without calling the RPC", async () => {
    getClaims.mockResolvedValue({ data: null })
    const response = await get("scope=all&cols=full_name")
    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({ code: "NOT_AUTHORIZED" })
    expect(callRpc).not.toHaveBeenCalled()
  })

  it("malformed parameters -> 400 without calling the RPC", async () => {
    for (const query of [
      "scope=all&cols=",
      "scope=all&cols=full_name,dietary_notes",
      "scope=search&q=ר&cols=full_name",
    ]) {
      const response = await get(query)
      expect(response.status, query).toBe(400)
      expect(await response.json()).toEqual({ code: "INVALID_INPUT" })
    }
    expect(callRpc).not.toHaveBeenCalled()
  })

  it.each([
    ["NOT_AUTHORIZED", 403],
    ["INVALID_INPUT", 400],
    ["SERVER_ERROR", 500],
  ])("RPC %s -> %i with {code}", async (code, status) => {
    callRpc.mockResolvedValue({ ok: false, code })
    const response = await get("scope=all&cols=full_name")
    expect(response.status).toBe(status)
    expect(response.headers.get("cache-control")).toBe("private, no-store")
    expect(await response.json()).toEqual({ code })
  })

  it("an unexpected RPC answer -> 500", async () => {
    callRpc.mockResolvedValue({ ok: true, data: { rows: "nope" } })
    expect((await get("scope=all&cols=full_name")).status).toBe(500)
  })
})
