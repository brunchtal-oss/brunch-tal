import { renderToStaticMarkup } from "react-dom/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { adminCopy } from "@/lib/copy/admin"

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
}))
const callRpc = vi.fn()
vi.mock("@/lib/rpc", () => ({
  callRpc: (...args: unknown[]) => callRpc(...args),
}))
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ session: true }),
}))

const { RefundsSection } = await import("./refunds-section")

const copy = adminCopy.refunds

const OPEN = {
  refund_request_id: "r1",
  status: "requested",
  customer_id: "44444444-4444-4444-8444-444444444444",
  customer_label: "Noa",
  amount_agorot: 18000,
  requested_at: "2026-10-10T07:00:00Z",
  refunded_on: null,
  reference: null,
  concept_name: "שישי מיוחד",
  starts_at: "2026-10-16T07:00:00Z",
  product_name: "בראנץ׳ בודד",
  paid_agorot: 18000,
  max_agorot: 18000,
}

const DONE = {
  ...OPEN,
  refund_request_id: "r2",
  status: "completed",
  amount_agorot: 12000,
  refunded_on: "2026-10-12",
  reference: "1234",
}

async function render() {
  const node = await RefundsSection()
  return node ? renderToStaticMarkup(node) : null
}

beforeEach(() => {
  callRpc.mockReset()
})

describe("RefundsSection (story 3.9)", () => {
  it("no request at all: nothing", async () => {
    callRpc.mockResolvedValue({ ok: true, data: [] })
    expect(await render()).toBeNull()
    expect(callRpc.mock.calls[0][1]).toBe("admin_list_refund_requests")
  })

  it("open requests only, each with its anchor and button; a completed one is not shown", async () => {
    callRpc.mockResolvedValue({ ok: true, data: [OPEN, DONE] })
    const html = (await render())!
    const text = html.replace(/\s/g, " ")
    expect(html).toContain(copy.title)
    expect(html).toContain('id="refund-r1"')
    expect(html).not.toContain('id="refund-r2"')
    expect(html.split(copy.button).length - 1).toBe(1)
    expect(text).toContain("בקשת החזר של 180 ₪")
    expect(text).not.toContain("הוחזר 120 ₪")
  })

  it("only completed ones: the section is not shown", async () => {
    callRpc.mockResolvedValue({ ok: true, data: [DONE] })
    expect(await render()).toBeNull()
  })

  it("a failed read throws (the page's error boundary)", async () => {
    callRpc.mockResolvedValue({ ok: false, code: "SERVER_ERROR" })
    await expect(RefundsSection()).rejects.toThrow()
  })
})
