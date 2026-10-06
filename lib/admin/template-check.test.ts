import { describe, expect, it } from "vitest"

import { checkTemplate, renderSample } from "./template-check"

const DATE_TIME = ["date", "time"]

describe("checkTemplate", () => {
  it.each([
    ["no fields", "ההרשמה אושרה", []],
    ["allowed fields", "נתראה ב{date} ב-{time}", DATE_TIME],
    ["a field twice", "{date} · {date}", DATE_TIME],
    ["empty text", "", []],
  ])("accepts %s", (_, text, allowed) => {
    expect(checkTemplate(text, allowed)).toEqual({ ok: true })
  })

  it("names a field the type does not pass", () => {
    expect(checkTemplate("בתוקף עד {expires_on}", ["date"])).toEqual({
      ok: false,
      reason: "unknown_field",
      field: "expires_on",
    })
  })

  it("refuses any field when the type passes none", () => {
    expect(checkTemplate("{date}", [])).toMatchObject({
      reason: "unknown_field",
    })
  })

  it.each([
    ["an open brace", "נתראה {date"],
    ["a lone closing brace", "}"],
    ["a closing brace before a field", "a } {date}"],
    ["empty braces", "{}"],
    ["a brace inside a field", "{a{date}"],
    ["a closing brace after a field", "{date} }"],
  ])("refuses %s", (_, text) => {
    expect(checkTemplate(text, DATE_TIME)).toEqual({
      ok: false,
      reason: "unbalanced",
    })
  })
})

describe("renderSample", () => {
  it("replaces the known fields and leaves the rest", () => {
    expect(
      renderSample("{date} ב-{time} {other}", { date: "12.11", time: "10:30" })
    ).toBe("12.11 ב-10:30 {other}")
  })
})
