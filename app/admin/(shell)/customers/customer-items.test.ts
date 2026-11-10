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
  choiceActivity,
  filterChoice,
  filterCount,
  parseInterests,
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
      interests: [],
    })
    expect(listRequest("רונ", "inactive")).toEqual({
      query: "רונ",
      activity: "all",
      interests: [],
    })
  })

  it("an empty field lists the open category; none open -> nothing", () => {
    expect(listRequest("", "inactive")).toEqual({
      query: "",
      activity: "inactive",
      interests: [],
    })
    expect(listRequest("  ", "all")).toEqual({
      query: "",
      activity: "all",
      interests: [],
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
    interests: [],
    ok: true,
  }

  it("the answer for the same request", () => {
    expect(
      answerForFilter({ query: "רונ", activity: "all", interests: [] }, answer)
    ).toBe(answer)
  })

  it("null for another query or category, no request or no answer", () => {
    expect(
      answerForFilter({ query: "רוני", activity: "all", interests: [] }, answer)
    ).toBeNull()
    expect(
      answerForFilter(
        { query: "רונ", activity: "inactive", interests: [] },
        answer
      )
    ).toBeNull()
    expect(
      answerForFilter({ query: "", activity: "all", interests: [] }, answer)
    ).toBeNull()
    expect(answerForFilter(null, answer)).toBeNull()
    expect(
      answerForFilter({ query: "רונ", activity: "all", interests: [] }, null)
    ).toBeNull()
  })
})

describe("emptyText (story 5.13)", () => {
  it("a search, or each category's own", () => {
    expect(emptyText({ query: "רונ", activity: "all", interests: [] })).toBe(
      "לא נמצאו לקוחות"
    )
    expect(emptyText({ query: "", activity: "all", interests: [] })).toBe(
      "אין עדיין לקוחות"
    )
    expect(emptyText({ query: "", activity: "active", interests: [] })).toBe(
      "אין לקוחות פעילות"
    )
    expect(emptyText({ query: "", activity: "inactive", interests: [] })).toBe(
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

  const search = { query: "רונ", activity: "all" as const, interests: [] }

  it("the untouched screen (no category, under 2 characters): every customer", () => {
    expect(shownList(null, null)).toBeNull()
  })

  it("a category from the request, also while its answer is pending or failed", () => {
    const request = { query: "", activity: "inactive" as const, interests: [] }
    const category = { kind: "category", activity: "inactive", interests: [] }
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
        interests: [],
        list: list(5),
      })
    ).toEqual(pending)
  })
})

// Story 2.16 (phone-check fix, user decision 2026-11-10): the "סינון"
// sheet. ?interest= holds several codes; OR within a group, AND between.
describe("the filter", () => {
  it("reads interest: known codes joined by ',', in code order, else no filter", () => {
    expect(parseInterests({ interest: "grandma" })).toEqual(["grandma"])
    expect(parseInterests({ interest: "grandpa,couples" })).toEqual([
      "couples",
      "grandpa",
    ])
    expect(parseInterests({ interest: ["couples", "grandpa"] })).toEqual([
      "couples",
    ])
    expect(parseInterests({ interest: "couples,aunt" })).toEqual([])
    expect(parseInterests({ interest: "couples,couples" })).toEqual([])
    expect(parseInterests({})).toEqual([])
  })

  it("the address keeps the category and the codes", () => {
    expect(categoryHref("inactive", ["grandpa", "grandma"])).toBe(
      "/admin/customers?activity=inactive&interest=grandma,grandpa"
    )
    expect(categoryHref("all", [])).toBe("/admin/customers?activity=all")
  })

  it("the sheet's choice: both activities or none is every customer", () => {
    expect(choiceActivity({ activities: [], interests: [] })).toBe("all")
    expect(
      choiceActivity({ activities: ["active", "inactive"], interests: [] })
    ).toBe("all")
    expect(choiceActivity({ activities: ["inactive"], interests: [] })).toBe(
      "inactive"
    )
    expect(filterChoice("all", ["couples"])).toEqual({
      activities: [],
      interests: ["couples"],
    })
    expect(filterChoice("active", [])).toEqual({
      activities: ["active"],
      interests: [],
    })
  })

  it("the button's number: one activity, and each special brunch", () => {
    expect(filterCount(null, [])).toBe(0)
    expect(filterCount("all", [])).toBe(0)
    expect(filterCount("active", [])).toBe(1)
    expect(filterCount("active", ["couples", "grandma"])).toBe(3)
    expect(filterCount("all", ["grandpa"])).toBe(1)
  })

  it("narrows the open category; a search is over every customer", () => {
    expect(listRequest("", "inactive", ["grandma", "couples"])).toEqual({
      query: "",
      activity: "inactive",
      interests: ["grandma", "couples"],
    })
    expect(listRequest("רונ", "inactive", ["grandma"])).toEqual({
      query: "רונ",
      activity: "all",
      interests: [],
    })
  })

  it("an answer for another filter is not shown", () => {
    const answer = {
      query: "",
      activity: "all" as const,
      interests: ["couples" as const],
    }
    expect(
      answerForFilter(
        { query: "", activity: "all", interests: ["couples", "grandma"] },
        answer
      )
    ).toBeNull()
    expect(
      answerForFilter(
        { query: "", activity: "all", interests: ["couples"] },
        answer
      )
    ).toBe(answer)
  })

  it("the export follows the filter of the open category", () => {
    expect(
      shownList(
        { query: "", activity: "active", interests: ["couples", "grandpa"] },
        null
      )
    ).toEqual({
      kind: "category",
      activity: "active",
      interests: ["couples", "grandpa"],
    })
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
