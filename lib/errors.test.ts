import { describe, expect, it } from "vitest"

import {
  ERROR_MESSAGES,
  detailFromPostgrestError,
  errorMessage,
  isErrorCode,
} from "./errors"

describe("errors", () => {
  it("maps ACCOUNT_NOT_ACTIVE to its microcopy", () => {
    expect(isErrorCode("ACCOUNT_NOT_ACTIVE")).toBe(true)
    expect(errorMessage("ACCOUNT_NOT_ACTIVE")).toBe(
      ERROR_MESSAGES.ACCOUNT_NOT_ACTIVE
    )
  })

  it("maps LINK_IN_PROGRESS (story 2.4) to its microcopy", () => {
    expect(isErrorCode("LINK_IN_PROGRESS")).toBe(true)
    expect(errorMessage("LINK_IN_PROGRESS")).toBe(
      "הלקוחה באמצע הצטרפות. אפשר לבטל או להחליף אחרי 15 דקות"
    )
  })

  it("maps NOT_FOUND (story 5.1) to its microcopy", () => {
    expect(isErrorCode("NOT_FOUND")).toBe(true)
    expect(errorMessage("NOT_FOUND")).toBe(ERROR_MESSAGES.NOT_FOUND)
  })

  it("shows an unknown code as a server error", () => {
    expect(errorMessage("NOPE")).toBe(ERROR_MESSAGES.SERVER_ERROR)
  })

  it("keeps only field and index from an error's detail", () => {
    expect(
      detailFromPostgrestError({
        details: '{"field": "birth_date", "index": 1, "value": "x"}',
      })
    ).toEqual({ field: "birth_date", index: 1 })
    expect(detailFromPostgrestError({ details: '{"field": "phone"}' })).toEqual(
      { field: "phone" }
    )
  })

  it.each([
    ["no detail", {}],
    ["null", { details: null }],
    ["not JSON", { details: "Failing row contains (...)" }],
    ["no known key", { details: '{"other": 1}' }],
    ["wrong types", { details: '{"field": 3, "index": "1"}' }],
  ])("returns undefined for %s", (_label, error) => {
    expect(detailFromPostgrestError(error)).toBeUndefined()
  })
})
