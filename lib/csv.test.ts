import { describe, expect, it } from "vitest"

import { toCsv } from "./csv"

const BOM = "\uFEFF"

describe("toCsv", () => {
  it("starts with a BOM, quotes every field and ends lines with CRLF", () => {
    expect(
      toCsv(
        ["שם", "טלפון"],
        [
          ["רונית", "054-123-4567"],
          ["דנה", null],
        ]
      )
    ).toBe(`${BOM}"שם","טלפון"\r\n"רונית","054-123-4567"\r\n"דנה",""\r\n`)
  })

  it("writes the header row with no rows", () => {
    expect(toCsv(["שם"], [])).toBe(`${BOM}"שם"\r\n`)
  })

  it("doubles quotes and keeps commas and line breaks inside the field", () => {
    expect(toCsv(["a"], [['he said "hi", then\nwent']])).toBe(
      `${BOM}"a"\r\n"he said ""hi"", then\nwent"\r\n`
    )
  })

  it.each([
    ['=HYPERLINK("x")', `"'=HYPERLINK(""x"")"`],
    ["=1+1", `"'=1+1"`],
    ["+1", `"'+1"`],
    ["-1", `"'-1"`],
    ["@a", `"'@a"`],
    ["\tcmd", `"'\tcmd"`],
    ["\rcmd", `"'\rcmd"`],
  ])("guards a formula cell %j", (value, expected) => {
    expect(toCsv(["a"], [[value]])).toBe(`${BOM}"a"\r\n${expected}\r\n`)
  })

  it("leaves a formula character that is not first, and an empty cell, alone", () => {
    expect(toCsv(["a", "b", "c"], [["a=1", "", undefined]])).toBe(
      `${BOM}"a","b","c"\r\n"a=1","",""\r\n`
    )
  })
})
