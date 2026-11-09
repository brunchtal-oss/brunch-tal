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
  parseInterest,
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
      interest: null,
    })
    expect(listRequest("רונ", "inactive")).toEqual({
      query: "רונ",
      activity: "all",
      interest: null,
    })
  })

  it("an empty field lists the open category; none open -> nothing", () => {
    expect(listRequest("", "inactive")).toEqual({
      query: "",
      activity: "inactive",
      interest: null,
    })
    expect(listRequest("  ", "all")).toEqual({
      query: "",
      activity: "all",
      interest: null,
    })
    expect(listRequest("", null)).toBeNull()
  })

  it("one character: nothing, even with a category open", () => {
    expect(listRequest("ר", "active")).toBeNull()
    expect(listRequest(" ר ", null)).toBeNull()
  })
})

describe("answerForFilter (story 5.13)", () => {
  const answer = {
    query: "רונ",
    activity: "all" as const,
    interest: null,
    ok: true,
  }

  it("the answer for the same request", () => {
    expect(
      answerForFilter({ query: "רונ", activity: "all", interest: null }, answer)
    ).toBe(answer)
  })

  it("null for another query or category, no request or no answer", () => {
    expect(
      answerForFilter(
        { query: "רוני", activity: "all", interest: null },
        answer
      )
    ).toBeNull()
    expect(
      answerForFilter(
        { query: "רונ", activity: "inactive", interest: null },
        answer
      )
    ).toBeNull()
    expect(
      answerForFilter({ query: "", activity: "all", interest: null }, answer)
    ).toBeNull()
    expect(answerForFilter(null, answer)).toBeNull()
    expect(
      answerForFilter({ query: "רונ", activity: "all", interest: null }, null)
    ).toBeNull()
  })
})

describe("emptyText (story 5.13)", () => {
  it("a search, or each category's own", () => {
    expect(emptyText({ query: "רונ", activity: "all", interest: null })).toBe(
      "לא נמצאו לקוחות"
    )
    expect(emptyText({ query: "", activity: "all", interest: null })).toBe(
      "אין עדיין לקוחות"
    )
    expect(emptyText({ query: "", activity: "active", interest: null })).toBe(
      "אין לקוחות פעילות"
    )
    expect(emptyText({ query: "", activity: "inactive", interest: null })).toBe(
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

  const search = { query: "רונ", activity: "all" as const, interest: null }

  it("the untouched screen (no category, under 2 characters): every customer", () => {
    expect(shownList(null, null)).toBeNull()
  })

  it("a category from the request, also while its answer is pending or failed", () => {
    const request = { query: "", activity: "inactive" as const, interest: null }
    const category = { kind: "category", activity: "inactive", interest: null }
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
      shownList(search, {
        query: "רו",
        activity: "all",
        interest: null,
        list: list(5),
      })
    ).toEqual(pending)
  })
})

// Story 2.16: the special-brunch filter (?interest=), with the categories.
describe("the special-brunch filter", () => {
  it("reads interest: a known code, else no filter (an invalid param)", () => {
    expect(parseInterest({ interest: "grandma" })).toBe("grandma")
    expect(parseInterest({ interest: ["couples", "grandpa"] })).toBe("couples")
    expect(parseInterest({ interest: "aunt" })).toBeNull()
    expect(parseInterest({})).toBeNull()
  })

  it("a chip keeps the category, a category keeps the chip", () => {
    expect(categoryHref("inactive", "grandma")).toBe(
      "/admin/customers?activity=inactive&interest=grandma"
    )
    expect(categoryHref("all", null)).toBe("/admin/customers?activity=all")
  })

  it("narrows the open category; a search is over every customer", () => {
    expect(listRequest("", "inactive", "grandma")).toEqual({
      query: "",
      activity: "inactive",
      interest: "grandma",
    })
    expect(listRequest("רונ", "inactive", "grandma")).toEqual({
      query: "רונ",
      activity: "all",
      interest: null,
    })
  })

  it("an answer for another filter is not shown", () => {
    const answer = { query: "", activity: "all" as const, interest: null }
    expect(
      answerForFilter(
        { query: "", activity: "all", interest: "couples" },
        answer
      )
    ).toBeNull()
  })

  it("the export follows the filter of the open category", () => {
    expect(
      shownList({ query: "", activity: "active", interest: "couples" }, null)
    ).toEqual({ kind: "category", activity: "active", interest: "couples" })
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
