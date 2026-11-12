import { describe, expect, it } from "vitest"

import {
  DEFAULT_DOMAIN,
  isTriggerRefusal,
  parseDomain,
  runAuthGuardCheck,
} from "../scripts/auth-guard-runner.mjs"

// Story 6.11: the pure parts of the shared guard check (no network).
describe("parseDomain", () => {
  it("defaults to the business domain (not the send. CNAME)", () => {
    expect(parseDomain([])).toEqual({ domain: DEFAULT_DOMAIN })
    expect(DEFAULT_DOMAIN).toBe("morethanfood.co.il")
  })

  it.each([
    [["--domain", "Mail.Example.org"], "mail.example.org"],
    [["--apply", "--domain=x.co.il"], "x.co.il"],
  ])("reads %j", (argv, domain) => {
    expect(parseDomain(argv)).toEqual({ domain })
  })

  it.each([[["--domain"]], [["--domain=nodot"]], [["--domain", "a b.com"]]])(
    "refuses %j",
    (argv) => {
      expect(parseDomain(argv)).toHaveProperty("error")
    }
  )
})

describe("isTriggerRefusal", () => {
  it("counts only the database error the trigger causes", () => {
    expect(isTriggerRefusal({ status: 500 })).toBe(true)
    expect(isTriggerRefusal({ message: "Database error updating user" })).toBe(
      true
    )
    expect(
      isTriggerRefusal({ status: 400, code: "email_address_invalid" })
    ).toBe(false)
    expect(isTriggerRefusal(null)).toBe(false)
  })
})

describe("runAuthGuardCheck", () => {
  it("a dry run only prints the plan and touches nothing", async () => {
    const lines: string[] = []
    const failed = await runAuthGuardCheck({
      label: "test",
      apply: false,
      domain: DEFAULT_DOMAIN,
      admin: null as never,
      newUserClient: () => null as never,
      log: (line: string) => lines.push(line),
    })
    expect(failed).toBe(0)
    // It says which domain the throwaway address will use, and the MX check.
    expect(lines.join("\n")).toContain(DEFAULT_DOMAIN)
    expect(lines.join("\n")).toContain("nslookup -type=MX")
  })
})
