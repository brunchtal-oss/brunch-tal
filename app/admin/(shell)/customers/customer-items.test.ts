import { describe, expect, it } from "vitest"

import { adminCopy } from "@/lib/copy/admin"

import {
  customerHref,
  listHref,
  parseQuery,
  toCustomerItem,
} from "./customer-items"

const copy = adminCopy.customers
const ID = "11111111-1111-4111-8111-111111111111"

describe("the query in the URL", () => {
  it("reads q (the first of a repeated one), cut to 100 characters", () => {
    expect(parseQuery({ q: "רוני" })).toBe("רוני")
    expect(parseQuery({ q: ["a", "b"] })).toBe("a")
    expect(parseQuery({})).toBe("")
    expect(parseQuery({ q: "x".repeat(150) })).toHaveLength(100)
  })

  it("writes q back, and drops an empty one", () => {
    expect(listHref("רוני כהן")).toBe(
      `/admin/customers?q=${encodeURIComponent("רוני כהן")}`
    )
    expect(listHref("  ")).toBe("/admin/customers")
    expect(listHref("")).toBe("/admin/customers")
  })
})

describe("toCustomerItem", () => {
  it("words a customer with activity and a phone", () => {
    expect(
      toCustomerItem({
        id: ID,
        full_name: "רוני כהן",
        phone_e164: "+972541234567",
        activated: true,
        last_activity_on: "2026-10-05",
      })
    ).toEqual({
      key: ID,
      href: `/admin/customers/${ID}`,
      name: "רוני כהן",
      phone: "054-123-4567",
      activity: copy.lastActivity("05.10.26"),
      activityOn: "2026-10-05",
      notActivated: false,
    })
  })

  it("without activity, a phone or activation", () => {
    const item = toCustomerItem({
      id: ID,
      full_name: "דנה",
      phone_e164: null,
      activated: false,
      last_activity_on: null,
    })
    expect(item.activity).toBe(copy.noActivity)
    expect(item.phone).toBeNull()
    expect(item.notActivated).toBe(true)
  })

  it("links to the card", () => {
    expect(customerHref(ID)).toBe(`/admin/customers/${ID}`)
  })
})
