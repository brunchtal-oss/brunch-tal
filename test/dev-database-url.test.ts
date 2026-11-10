// The env guard of the database tests (supabase/tests/support/db.ts) is pure,
// so it runs in `npm test` and CI: it must refuse before any connection.

import { describe, expect, it } from "vitest"

import {
  devDatabaseUrl,
  isProdTarget,
  targetDatabaseUrl,
} from "../supabase/tests/support/db"

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

// Story 6.1: DB_TARGET=prod with the prod:grants marker points the pool at
// PROD_DATABASE_URL from .env.prod.local (read-only), with the prod guards.
describe("targetDatabaseUrl", () => {
  const PROD_REF = "prodprodprodprodprod"
  const PROD_POOLER = `postgresql://postgres.${PROD_REF}:secretpw@aws-1-eu-central-1.pooler.supabase.com:5432/postgres`
  const devEnv = { NEXT_PUBLIC_SUPABASE_URL: API, DEV_DATABASE_URL: POOLER }
  const env = { ...devEnv, DB_TARGET: "prod", PROD_GRANTS_RUN: "1" }
  const prodFile = {
    PROD_SUPABASE_URL: `https://${PROD_REF}.supabase.co`,
    PROD_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_x",
    PROD_SUPABASE_SECRET_KEY: "sb_secret_x",
    PROD_DATABASE_URL: PROD_POOLER,
  }

  it("stays on dev without DB_TARGET, and never reads the prod file", () => {
    expect(
      targetDatabaseUrl(devEnv, () => {
        throw new Error("read")
      })
    ).toBe(POOLER)
    expect(isProdTarget({})).toBe(false)
  })

  it("returns PROD_DATABASE_URL from the prod file under prod:grants", () => {
    expect(isProdTarget(env)).toBe(true)
    expect(targetDatabaseUrl(env, () => prodFile)).toBe(PROD_POOLER)
  })

  it("refuses DB_TARGET=prod without the prod:grants marker", () => {
    expect(() => isProdTarget({ DB_TARGET: "prod" })).toThrow(/prod:grants/)
    expect(() =>
      targetDatabaseUrl({ ...devEnv, DB_TARGET: "prod" }, () => prodFile)
    ).toThrow(/prod:grants/)
  })

  it("ignores PROD_* in process env: only the prod file counts", () => {
    expect(() =>
      targetDatabaseUrl({ ...env, ...prodFile }, () => null)
    ).toThrow(/[.]env[.]prod[.]local/)
  })

  it("refuses prod values that point at the dev project, without echoing them", () => {
    const toDev = {
      ...prodFile,
      PROD_SUPABASE_URL: API,
      PROD_DATABASE_URL: POOLER,
    }
    expect(() => targetDatabaseUrl(env, () => toDev)).toThrow(/פרויקט הפיתוח/)
    try {
      targetDatabaseUrl(env, () => toDev)
    } catch (error) {
      expect((error as Error).message).not.toContain("pw@")
    }
  })

  it("refuses a missing prod variable and an unknown target", () => {
    expect(() =>
      targetDatabaseUrl(env, () => ({
        ...prodFile,
        PROD_DATABASE_URL: undefined,
      }))
    ).toThrow(/PROD_DATABASE_URL/)
    expect(() => isProdTarget({ DB_TARGET: "production" })).toThrow(/DB_TARGET/)
  })
})
