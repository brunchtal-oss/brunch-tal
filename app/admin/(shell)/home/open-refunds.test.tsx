import { renderToStaticMarkup } from "react-dom/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { adminCopy } from "@/lib/copy/admin"

import type { HomeData } from "../home-items"

const loadHome = vi.fn<() => Promise<HomeData>>()

vi.mock("./load-home", () => ({
  loadHome: () => loadHome(),
  loadAttentionItems: async () => [],
}))

const { OpenRefunds } = await import("./open-refunds")

const copy = adminCopy.home
const CUSTOMER = "44444444-4444-4444-8444-444444444444"

function home(open_refunds: HomeData["open_refunds"]): HomeData {
  return {
    upcoming_sessions: [],
    expiring_cards: [],
    totals: {
      period_start: "2026-10-01",
      period_end: "2026-10-10",
      approved_count: 0,
      approved_agorot: 0,
      refunded_count: 0,
      refunded_agorot: 0,
      net_agorot: 0,
    },
    open_refunds,
  }
}

const ROW = {
  refund_request_id: "r1",
  customer_id: CUSTOMER,
  customer_label: "Noa",
  amount_agorot: 12800,
  requested_at: "2026-10-10T07:00:00Z",
  event_id: "e1",
  concept_name: "שישי מיוחד",
  starts_at: "2026-10-16T07:00:00Z",
}

beforeEach(() => {
  loadHome.mockReset()
})

describe("OpenRefunds (story 3.7)", () => {
  it("nothing open: no section", async () => {
    loadHome.mockResolvedValue(home([]))
    expect(await OpenRefunds()).toBeNull()
  })

  it("a row per request, linked to the customer's card; plain text while unbound", async () => {
    loadHome.mockResolvedValue(
      home([
        ROW,
        {
          ...ROW,
          refund_request_id: "r2",
          customer_id: null,
          customer_label: null,
        },
      ])
    )
    const html = renderToStaticMarkup((await OpenRefunds())!)
    expect(html).toContain(copy.openRefunds)
    expect(html).toContain(`href="/admin/customers/${CUSTOMER}"`)
    expect(html.replace(/\s/g, " ")).toContain(
      "Noa · 128 ₪ · בראנץ׳ שישי מיוחד 16.10"
    )
    expect(html).toContain(copy.newCustomer)
    expect(html.split("<li").length - 1).toBe(2)
    expect(html.split("<a ").length - 1).toBe(1)
    expect(html).not.toContain("בוצע")
  })
})
