import { describe, expect, it } from "vitest"

import { ERROR_MESSAGES, errorMessage, isErrorCode } from "./errors"

describe("errors", () => {
  it("maps ACCOUNT_NOT_ACTIVE to its microcopy", () => {
    expect(isErrorCode("ACCOUNT_NOT_ACTIVE")).toBe(true)
    expect(errorMessage("ACCOUNT_NOT_ACTIVE")).toBe(
      ERROR_MESSAGES.ACCOUNT_NOT_ACTIVE
    )
  })

  it("shows an unknown code as a server error", () => {
    expect(errorMessage("NOPE")).toBe(ERROR_MESSAGES.SERVER_ERROR)
  })
})
