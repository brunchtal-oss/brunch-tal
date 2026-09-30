// The env guard of the database tests (supabase/tests/support/db.ts) is pure,
// so it runs in `npm test` and CI: it must refuse before any connection.

import { describe, expect, it } from "vitest"

import { devDatabaseUrl } from "../supabase/tests/support/db"

const API = "https://abcdefghijklmnopqrst.supabase.co"
const POOLER =
  "postgresql://postgres.abcdefghijklmnopqrst:pw@aws-1-eu-central-1.pooler.supabase.com:5432/postgres"

describe("devDatabaseUrl", () => {
  it("returns the string when it contains the dev project ref", () => {
    expect(
      devDatabaseUrl({
        DEV_DATABASE_URL: POOLER,
        NEXT_PUBLIC_SUPABASE_URL: API,
      })
    ).toBe(POOLER)
  })

  it("refuses when DEV_DATABASE_URL is missing", () => {
    expect(() => devDatabaseUrl({ NEXT_PUBLIC_SUPABASE_URL: API })).toThrow(
      /DEV_DATABASE_URL is missing/
    )
  })

  it("refuses a connection string of another project", () => {
    expect(() =>
      devDatabaseUrl({
        DEV_DATABASE_URL: POOLER.replace(
          "abcdefghijklmnopqrst",
          "zzzzzzzzzzzzzzzzzzzz"
        ),
        NEXT_PUBLIC_SUPABASE_URL: API,
      })
    ).toThrow(/does not contain the project ref/)
  })

  it("accepts the direct connection host of the dev project", () => {
    const direct =
      "postgresql://postgres:pw@db.abcdefghijklmnopqrst.supabase.co:5432/postgres"
    expect(
      devDatabaseUrl({
        DEV_DATABASE_URL: direct,
        NEXT_PUBLIC_SUPABASE_URL: API,
      })
    ).toBe(direct)
  })

  it("refuses when the ref appears only in the password or query", () => {
    for (const url of [
      "postgresql://postgres.zzzzzzzzzzzzzzzzzzzz:abcdefghijklmnopqrst@aws-1-eu-central-1.pooler.supabase.com:5432/postgres",
      "postgresql://postgres.zzzzzzzzzzzzzzzzzzzz:pw@aws-1-eu-central-1.pooler.supabase.com:5432/postgres?x=abcdefghijklmnopqrst",
    ]) {
      expect(() =>
        devDatabaseUrl({ DEV_DATABASE_URL: url, NEXT_PUBLIC_SUPABASE_URL: API })
      ).toThrow(/does not contain the project ref/)
    }
  })

  it("refuses a local API URL (no hosted project ref)", () => {
    expect(() =>
      devDatabaseUrl({
        DEV_DATABASE_URL:
          "postgresql://postgres.127:pw@127.0.0.1:54322/postgres",
        NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
      })
    ).toThrow(/NEXT_PUBLIC_SUPABASE_URL/)
  })

  it("refuses an invalid URL without echoing the password", () => {
    const secret = "s3cretPassw0rd"
    let message = ""
    try {
      devDatabaseUrl({
        // An invalid port makes the WHATWG URL parser throw.
        DEV_DATABASE_URL: `postgresql://postgres.abcdefghijklmnopqrst:${secret}@aws-1.pooler.supabase.com:54a32/postgres`,
        NEXT_PUBLIC_SUPABASE_URL: API,
      })
    } catch (error) {
      message = String(error) + String((error as Error).cause ?? "")
    }
    expect(message).toMatch(/not a valid URL.*Percent-encode/)
    expect(message).not.toContain(secret)
  })

  it("refuses when NEXT_PUBLIC_SUPABASE_URL is missing or invalid", () => {
    expect(() => devDatabaseUrl({ DEV_DATABASE_URL: POOLER })).toThrow(
      /NEXT_PUBLIC_SUPABASE_URL/
    )
    expect(() =>
      devDatabaseUrl({
        DEV_DATABASE_URL: POOLER,
        NEXT_PUBLIC_SUPABASE_URL: "not a url",
      })
    ).toThrow(/NEXT_PUBLIC_SUPABASE_URL/)
  })
})
