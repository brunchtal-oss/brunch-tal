import { describe, expect, it } from "vitest"

import { adminCopy } from "@/lib/copy/admin"

import {
  answerForFilter,
  categoryHref,
  customerHref,
  emptyText,
  listHref,
  listRequest,
  parseActivity,
  parseQuery,
  shownList,
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

describe("the category in the URL (story 5.13)", () => {
  it("reads activity: all, active or inactive; otherwise none", () => {
    expect(parseActivity({ activity: "inactive" })).toBe("inactive")
    expect(parseActivity({ activity: ["inactive", "active"] })).toBe("inactive")
    expect(parseActivity({ activity: "active" })).toBe("active")
    expect(parseActivity({ activity: "all" })).toBe("all")
    expect(parseActivity({ activity: "bogus" })).toBeNull()
    expect(parseActivity({})).toBeNull()
  })

  it("a button's address carries only its category; the search's only q", () => {
    expect(categoryHref("all")).toBe("/admin/customers?activity=all")
    expect(categoryHref("active")).toBe("/admin/customers?activity=active")
    expect(categoryHref("inactive")).toBe("/admin/customers?activity=inactive")
    expect(listHref("רוני")).toBe(
      `/admin/customers?q=${encodeURIComponent("רוני")}`
    )
  })
})

describe("listRequest (story 5.13)", () => {
  it("2+ characters search every customer, whatever category is open", () => {
    expect(listRequest(" רונ ", null)).toEqual({
      query: "רונ",
      activity: "all",
    })
    expect(listRequest("רונ", "inactive")).toEqual({
      query: "רונ",
      activity: "all",
    })
  })

  it("an empty field lists the open category; none open -> nothing", () => {
    expect(listRequest("", "inactive")).toEqual({
      query: "",
      activity: "inactive",
    })
    expect(listRequest("  ", "all")).toEqual({ query: "", activity: "all" })
    expect(listRequest("", null)).toBeNull()
  })

  it("one character: nothing, even with a category open", () => {
    expect(listRequest("ר", "active")).toBeNull()
    expect(listRequest(" ר ", null)).toBeNull()
  })
})

describe("answerForFilter (story 5.13)", () => {
  const answer = { query: "רונ", activity: "all" as const, ok: true }

  it("the answer for the same request", () => {
    expect(answerForFilter({ query: "רונ", activity: "all" }, answer)).toBe(
      answer
    )
  })

  it("null for another query or category, no request or no answer", () => {
    expect(
      answerForFilter({ query: "רוני", activity: "all" }, answer)
    ).toBeNull()
    expect(
      answerForFilter({ query: "רונ", activity: "inactive" }, answer)
    ).toBeNull()
    expect(answerForFilter({ query: "", activity: "all" }, answer)).toBeNull()
    expect(answerForFilter(null, answer)).toBeNull()
    expect(answerForFilter({ query: "רונ", activity: "all" }, null)).toBeNull()
  })
})

describe("emptyText (story 5.13)", () => {
  it("a search, or each category's own", () => {
    expect(emptyText({ query: "רונ", activity: "all" })).toBe("לא נמצאו לקוחות")
    expect(emptyText({ query: "", activity: "all" })).toBe("אין עדיין לקוחות")
    expect(emptyText({ query: "", activity: "active" })).toBe(
      "אין לקוחות פעילות"
    )
    expect(emptyText({ query: "", activity: "inactive" })).toBe(
      "אין לקוחות לא פעילות"
    )
  })
})

describe("shownList (story 5.13)", () => {
  const list = (n: number, more = false) => ({
    customers: Array.from({ length: n }, (_, i) => ({
      id: String(i),
      full_name: "x",
      phone_e164: null,
      activated: true,
      last_activity_on: null,
      inactive: false,
    })),
    has_more: more,
  })

  const search = { query: "רונ", activity: "all" as const }

  it("the untouched screen (no category, under 2 characters): every customer", () => {
    expect(shownList(null, null)).toBeNull()
  })

  it("a category from the request, also while its answer is pending or failed", () => {
    const request = { query: "", activity: "inactive" as const }
    const category = { kind: "category", activity: "inactive" }
    expect(shownList(request, null)).toEqual(category)
    expect(shownList(request, { ...request, list: list(3) })).toEqual(category)
  })

  it("a search with the count of its shown answer", () => {
    expect(shownList(search, { ...search, list: list(5) })).toEqual({
      kind: "search",
      query: "רונ",
      count: "5",
    })
    expect(
      shownList(search, { ...search, list: list(200, true) })
    ).toMatchObject({ count: "200+" })
  })

  it("a search without its answer shown (pending, failed or another query): no count", () => {
    const pending = { kind: "search", query: "רונ", count: null }
    expect(shownList(search, null)).toEqual(pending)
    expect(
      shownList(search, { query: "רו", activity: "all", list: list(5) })
    ).toEqual(pending)
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
        inactive: false,
      })
    ).toEqual({
      key: ID,
      href: `/admin/customers/${ID}`,
      name: "רוני כהן",
      phone: "054-123-4567",
      activity: copy.lastActivity("05.10.26"),
      activityOn: "2026-10-05",
      notActivated: false,
      inactive: false,
    })
  })

  it("without activity, a phone or activation", () => {
    const item = toCustomerItem({
      id: ID,
      full_name: "דנה",
      phone_e164: null,
      activated: false,
      last_activity_on: null,
      inactive: true,
    })
    expect(item.inactive).toBe(true)
    expect(item.activity).toBe(copy.noActivity)
    expect(item.phone).toBeNull()
    expect(item.notActivated).toBe(true)
  })

  it("links to the card", () => {
    expect(customerHref(ID)).toBe(`/admin/customers/${ID}`)
  })
})
