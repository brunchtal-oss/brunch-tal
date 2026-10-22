import { describe, expect, it } from "vitest"

import { devRef, isVideoEmail, parseEmail } from "../scripts/dev-guard.mjs"
import { FILMING_LOGIN_EMAILS } from "../scripts/video-cast.mjs"

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

  it("accepts a video email, in both forms, normalized", () => {
    expect(parseEmail(["--email", "Liraz.Kaplan@video.example.com"])).toEqual({
      email: "liraz.kaplan@video.example.com",
    })
    expect(parseEmail(["--email=liraz.kaplan@video.example.com"])).toEqual({
      email: "liraz.kaplan@video.example.com",
    })
  })

  it("refuses a non-video email, the old demo domain included", () => {
    expect(parseEmail(["--email", "maya@example.com"]).error).toBeTruthy()
    expect(parseEmail(["--email=maya@gmail.com"]).error).toBeTruthy()
    expect(
      parseEmail(["--email", "maya.barak@demo.example.com"]).error
    ).toBeTruthy()
  })

  it("refuses a lookalike domain", () => {
    expect(
      parseEmail(["--email", "x@video.example.com.evil"]).error
    ).toBeTruthy()
    expect(
      parseEmail(["--email", "x@evil@video.example.com"]).error
    ).toBeTruthy()
    expect(parseEmail(["--email", "x@xvideo.example.com"]).error).toBeTruthy()
  })

  it("refuses a missing value", () => {
    expect(parseEmail(["--email"]).error).toBeTruthy()
    expect(parseEmail(["--email="]).error).toBeTruthy()
    expect(parseEmail(["--email", "--url", "https://x.dev"]).error).toBeTruthy()
  })

  it("refuses --email together with --admin", () => {
    expect(
      parseEmail(["--admin", "--email", "liraz.kaplan@video.example.com"]).error
    ).toBeTruthy()
  })
})

describe("isVideoEmail", () => {
  it("accepts the video domain only, exactly", () => {
    expect(isVideoEmail("admin@video.example.com")).toBe(true)
    expect(isVideoEmail(" Michal.Aharoni@VIDEO.example.com ")).toBe(true)
    expect(isVideoEmail("x@demo.example.com")).toBe(false)
    expect(isVideoEmail("x@sub.video.example.com")).toBe(false)
    expect(isVideoEmail("x@video.example.com.evil")).toBe(false)
    expect(isVideoEmail("a@b@video.example.com")).toBe(false)
    expect(isVideoEmail("@video.example.com")).toBe(false)
    expect(isVideoEmail(null)).toBe(false)
  })
})

describe("parseEmail and the filming logins", () => {
  it("lists the filming admin and the three customer logins", () => {
    expect(FILMING_LOGIN_EMAILS).toEqual([
      "admin@video.example.com",
      "michal.aharoni@video.example.com",
      "neta.berger@video.example.com",
      "sivan.ashkenazi@video.example.com",
    ])
  })

  it("refuses a filming login, whatever the case", () => {
    for (const email of FILMING_LOGIN_EMAILS) {
      expect(
        parseEmail(["--email", email.toUpperCase()], FILMING_LOGIN_EMAILS).error
      ).toContain("VIDEO_LOGIN_PASSWORD")
    }
  })

  it("still accepts any other persona", () => {
    expect(
      parseEmail(
        ["--email", "liraz.kaplan@video.example.com"],
        FILMING_LOGIN_EMAILS
      )
    ).toEqual({ email: "liraz.kaplan@video.example.com" })
  })
})
