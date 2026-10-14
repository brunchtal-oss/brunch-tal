import { describe, expect, it } from "vitest"

import {
  EXPORT_COLUMN_KEYS,
  customersCsv,
  errorCodeOf,
  exportFileName,
  exportHref,
  exportRequest,
  parseExportParams,
  shownCount,
} from "./customer-export"

const BOM = "\uFEFF"

function parse(query: string) {
  return parseExportParams(new URLSearchParams(query))
}

describe("parseExportParams", () => {
  it("all with the three columns", () => {
    expect(parse("scope=all&cols=full_name,phone,email")).toEqual({
      ok: true,
      data: {
        scope: "all",
        query: null,
        columns: ["full_name", "phone", "email"],
      },
    })
  })

  it("search keeps the trimmed query; the columns come in file order", () => {
    expect(parse("scope=search&q=%20רונ%20&cols=email,full_name")).toEqual({
      ok: true,
      data: { scope: "search", query: "רונ", columns: ["full_name", "email"] },
    })
  })

  it("all ignores q", () => {
    expect(parse("scope=all&q=x&cols=phone")).toMatchObject({
      ok: true,
      data: { query: null },
    })
  })

  it.each([
    "",
    "cols=full_name",
    "scope=everything&cols=full_name",
    "scope=search&cols=full_name",
    "scope=search&q=ר&cols=full_name",
    "scope=search&q=%20ר%20&cols=full_name",
    `scope=search&q=${"א".repeat(101)}&cols=full_name`,
    "scope=all",
    "scope=all&cols=",
    "scope=all&cols=full_name,dietary_notes",
    "scope=all&cols=full_name,full_name",
    "scope=all&cols=id",
    "scope=all&cols=pending_email",
    "scope=all&cols=full_name,",
  ])("INVALID_INPUT for %j", (query) => {
    expect(parse(query)).toEqual({ ok: false, code: "INVALID_INPUT" })
  })

  it("accepts a 100-character query", () => {
    expect(parse(`scope=search&q=${"א".repeat(100)}&cols=full_name`).ok).toBe(
      true
    )
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
  it("all: no q, the columns in file order; parseExportParams reads it back", () => {
    const href = exportHref({
      scope: "all",
      query: "ignored",
      columns: ["email", "full_name"],
    })
    expect(href).toBe("/api/admin/export?scope=all&cols=full_name%2Cemail")
    expect(parseExportParams(new URL(href, "http://x").searchParams)).toEqual({
      ok: true,
      data: { scope: "all", query: null, columns: ["full_name", "email"] },
    })
  })

  it("search: the trimmed q", () => {
    const href = exportHref({
      scope: "search",
      query: " רונ ",
      columns: ["full_name", "phone", "email"],
    })
    expect(parseExportParams(new URL(href, "http://x").searchParams)).toEqual({
      ok: true,
      data: {
        scope: "search",
        query: "רונ",
        columns: ["full_name", "phone", "email"],
      },
    })
  })
})

describe("exportRequest", () => {
  const all = ["full_name", "phone", "email"] as const

  it("no shown search: all, without q, whatever the scope", () => {
    expect(exportRequest(null, "search", all)).toEqual({
      scope: "all",
      query: null,
      columns: [...all],
    })
  })

  it("a shown search: the search scope sends the shown query", () => {
    const search = { query: "רונ", count: "3" }
    expect(exportRequest(search, "search", ["phone"])).toEqual({
      scope: "search",
      query: "רונ",
      columns: ["phone"],
    })
    expect(exportRequest(search, "all", ["phone"])).toEqual({
      scope: "all",
      query: null,
      columns: ["phone"],
    })
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
