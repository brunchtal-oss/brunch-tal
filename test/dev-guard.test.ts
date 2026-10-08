import { describe, expect, it } from "vitest"

import { devRef, parseEmail } from "../scripts/dev-guard.mjs"

const REF = "abcdefghijklmnopqrst"
const OTHER = "zyxwvutsrqponmlkjihg"
const supabaseUrl = `https://${REF}.supabase.co`

describe("devRef", () => {
  it("accepts the session pooler user of the same project", () => {
    expect(
      devRef({
        supabaseUrl,
        databaseUrl: `postgresql://postgres.${REF}:pw@aws-0-eu-central-1.pooler.supabase.com:5432/postgres`,
      })
    ).toBe(REF)
  })

  it("accepts the direct host of the same project", () => {
    expect(
      devRef({
        supabaseUrl,
        databaseUrl: `postgresql://postgres:pw@db.${REF}.supabase.co:5432/postgres`,
      })
    ).toBe(REF)
  })

  it("refuses another project's ref", () => {
    expect(
      devRef({
        supabaseUrl,
        databaseUrl: `postgresql://postgres.${OTHER}:pw@aws-0-eu-central-1.pooler.supabase.com:5432/postgres`,
      })
    ).toBeNull()
    expect(
      devRef({
        supabaseUrl,
        databaseUrl: `postgresql://postgres:pw@db.${OTHER}.supabase.co:5432/postgres`,
      })
    ).toBeNull()
  })

  it("refuses a missing variable", () => {
    expect(devRef({ supabaseUrl })).toBeNull()
    expect(
      devRef({
        databaseUrl: `postgresql://postgres:pw@db.${REF}.supabase.co:5432/postgres`,
      })
    ).toBeNull()
    expect(devRef({})).toBeNull()
  })

  it("refuses an invalid URL", () => {
    expect(devRef({ supabaseUrl, databaseUrl: "not a url" })).toBeNull()
    expect(
      devRef({
        supabaseUrl: "not a url",
        databaseUrl: `postgresql://postgres:pw@db.${REF}.supabase.co:5432/postgres`,
      })
    ).toBeNull()
  })
})

describe("parseEmail", () => {
  it("is null without --email", () => {
    expect(parseEmail(["--admin"])).toEqual({ email: null })
  })

  it("accepts a demo email, in both forms, normalized", () => {
    expect(parseEmail(["--email", "Maya.Barak@demo.example.com"])).toEqual({
      email: "maya.barak@demo.example.com",
    })
    expect(parseEmail(["--email=maya.barak@demo.example.com"])).toEqual({
      email: "maya.barak@demo.example.com",
    })
  })

  it("refuses a non-demo email", () => {
    expect(parseEmail(["--email", "maya@example.com"]).error).toBeTruthy()
    expect(parseEmail(["--email=maya@gmail.com"]).error).toBeTruthy()
  })

  it("refuses a lookalike domain", () => {
    expect(
      parseEmail(["--email", "x@demo.example.com.evil"]).error
    ).toBeTruthy()
    expect(
      parseEmail(["--email", "x@evil@demo.example.com"]).error
    ).toBeTruthy()
  })

  it("refuses a missing value", () => {
    expect(parseEmail(["--email"]).error).toBeTruthy()
    expect(parseEmail(["--email="]).error).toBeTruthy()
    expect(parseEmail(["--email", "--url", "https://x.dev"]).error).toBeTruthy()
  })

  it("refuses --email together with --admin", () => {
    expect(
      parseEmail(["--admin", "--email", "maya.barak@demo.example.com"]).error
    ).toBeTruthy()
  })
})
