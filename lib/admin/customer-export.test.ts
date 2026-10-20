import { describe, expect, it } from "vitest"

import {
  EXPORT_COLUMN_KEYS,
  customersCsv,
  errorCodeOf,
  exportFileName,
  exportHref,
  exportLine,
  exportRequest,
  parseExportParams,
  shownCount,
} from "./customer-export"

const BOM = "\uFEFF"

function parse(query: string) {
  return parseExportParams(new URLSearchParams(query))
}

describe("parseExportParams", () => {
  it("all with its category and the three columns", () => {
    expect(
      parse("scope=all&activity=inactive&cols=full_name,phone,email")
    ).toEqual({
      ok: true,
      data: {
        scope: "all",
        query: null,
        activity: "inactive",
        columns: ["full_name", "phone", "email"],
      },
    })
  })

  it("search keeps the trimmed query and the category; the columns come in file order", () => {
    expect(
      parse("scope=search&q=%20רונ%20&activity=all&cols=email,full_name")
    ).toEqual({
      ok: true,
      data: {
        scope: "search",
        query: "רונ",
        activity: "all",
        columns: ["full_name", "email"],
      },
    })
  })

  it("all ignores q", () => {
    expect(parse("scope=all&q=x&activity=all&cols=phone")).toMatchObject({
      ok: true,
      data: { query: null, activity: "all" },
    })
  })

  it.each([
    "",
    "cols=full_name",
    "scope=everything&activity=all&cols=full_name",
    "scope=search&activity=all&cols=full_name",
    "scope=search&q=ר&activity=all&cols=full_name",
    "scope=search&q=%20ר%20&activity=all&cols=full_name",
    `scope=search&q=${"א".repeat(101)}&activity=all&cols=full_name`,
    "scope=search&q=רונ&cols=full_name",
    "scope=search&q=רונ&activity=bogus&cols=full_name",
    "scope=search&q=רונ&activity=&cols=full_name",
    "scope=all&cols=full_name",
    "scope=all&activity=bogus&cols=full_name",
    "scope=all&activity=all",
    "scope=all&activity=all&cols=",
    "scope=all&activity=all&cols=full_name,dietary_notes",
    "scope=all&activity=all&cols=full_name,full_name",
    "scope=all&activity=all&cols=id",
    "scope=all&activity=all&cols=pending_email",
    "scope=all&activity=all&cols=full_name,",
  ])("INVALID_INPUT for %j", (query) => {
    expect(parse(query)).toEqual({ ok: false, code: "INVALID_INPUT" })
  })

  it("accepts a 100-character query", () => {
    expect(
      parse(`scope=search&q=${"א".repeat(100)}&activity=all&cols=full_name`).ok
    ).toBe(true)
  })
})

describe("the closed column list", () => {
  it("is exactly name, phone and email", () => {
    expect(EXPORT_COLUMN_KEYS).toEqual(["full_name", "phone", "email"])
  })
})

describe("customersCsv", () => {
  const rows = [
    {
      full_name: "רונית כהן",
      phone_e164: "+972541234567",
      email: "ronit@example.test",
    },
    { full_name: "=1+1", phone_e164: null, email: null },
  ]

  it("writes the Hebrew headers and the local phone", () => {
    expect(customersCsv(rows, ["full_name", "phone", "email"])).toBe(
      `${BOM}"שם","טלפון","מייל"\r\n` +
        `"רונית כהן","054-123-4567","ronit@example.test"\r\n` +
        `"'=1+1","",""\r\n`
    )
  })

  it("only the chosen columns", () => {
    expect(customersCsv(rows, ["phone"])).toBe(
      `${BOM}"טלפון"\r\n"054-123-4567"\r\n""\r\n`
    )
  })

  it("the header row alone with no rows", () => {
    expect(customersCsv([], ["full_name", "email"])).toBe(
      `${BOM}"שם","מייל"\r\n`
    )
  })
})

describe("exportHref", () => {
  it("all: the category, no q, the columns in file order; parseExportParams reads it back", () => {
    const href = exportHref({
      scope: "all",
      query: "ignored",
      activity: "inactive",
      columns: ["email", "full_name"],
    })
    expect(href).toBe(
      "/api/admin/export?scope=all&activity=inactive&cols=full_name%2Cemail"
    )
    expect(parseExportParams(new URL(href, "http://x").searchParams)).toEqual({
      ok: true,
      data: {
        scope: "all",
        query: null,
        activity: "inactive",
        columns: ["full_name", "email"],
      },
    })
  })

  it("search: the trimmed q and the category", () => {
    const href = exportHref({
      scope: "search",
      query: " רונ ",
      activity: "all",
      columns: ["full_name", "phone", "email"],
    })
    expect(new URL(href, "http://x").searchParams.get("activity")).toBe("all")
    expect(parseExportParams(new URL(href, "http://x").searchParams)).toEqual({
      ok: true,
      data: {
        scope: "search",
        query: "רונ",
        activity: "all",
        columns: ["full_name", "phone", "email"],
      },
    })
  })
})

describe("exportRequest (story 5.13)", () => {
  const all = ["full_name", "phone", "email"] as const

  it("nothing shown: every customer", () => {
    expect(exportRequest(null, all)).toEqual({
      scope: "all",
      query: null,
      activity: "all",
      columns: [...all],
    })
  })

  it("a category: scope all with that category", () => {
    expect(
      exportRequest({ kind: "category", activity: "inactive" }, ["phone"])
    ).toEqual({
      scope: "all",
      query: null,
      activity: "inactive",
      columns: ["phone"],
    })
  })

  it("a search: its query over every customer", () => {
    expect(
      exportRequest({ kind: "search", query: "רונ", count: "3" }, ["phone"])
    ).toEqual({
      scope: "search",
      query: "רונ",
      activity: "all",
      columns: ["phone"],
    })
  })
})

describe("exportLine (story 5.13)", () => {
  it("what the file will hold", () => {
    expect(exportLine(null)).toBe("בחרת לייצא את כל הלקוחות")
    expect(exportLine({ kind: "category", activity: "all" })).toBe(
      "בחרת לייצא את כל הלקוחות"
    )
    expect(exportLine({ kind: "category", activity: "active" })).toBe(
      "בחרת לייצא את כל הלקוחות הפעילות"
    )
    expect(exportLine({ kind: "category", activity: "inactive" })).toBe(
      "בחרת לייצא את כל הלקוחות הלא פעילות"
    )
    expect(exportLine({ kind: "search", query: "רונ", count: "200+" })).toBe(
      "בחרת לייצא את תוצאות החיפוש (200+)"
    )
    expect(exportLine({ kind: "search", query: "רונ", count: null })).toBe(
      "בחרת לייצא את תוצאות החיפוש"
    )
  })
})

describe("shownCount", () => {
  it("the length, or 200+ when the list has more", () => {
    expect(shownCount(3, false, 200)).toBe("3")
    expect(shownCount(0, false, 200)).toBe("0")
    expect(shownCount(200, true, 200)).toBe("200+")
  })
})

describe("errorCodeOf", () => {
  it("the {code} of a JSON answer", async () => {
    expect(
      await errorCodeOf(
        new Response(JSON.stringify({ code: "NOT_AUTHORIZED" }), {
          status: 403,
        })
      )
    ).toBe("NOT_AUTHORIZED")
  })

  it("SERVER_ERROR for a body that is not JSON, or JSON without a code", async () => {
    expect(await errorCodeOf(new Response("<html>", { status: 401 }))).toBe(
      "SERVER_ERROR"
    )
    expect(
      await errorCodeOf(new Response(JSON.stringify({}), { status: 500 }))
    ).toBe("SERVER_ERROR")
  })
})

describe("exportFileName", () => {
  it("customers-YYYY-MM-DD.csv", () => {
    expect(exportFileName("2026-10-13")).toBe("customers-2026-10-13.csv")
  })
})
