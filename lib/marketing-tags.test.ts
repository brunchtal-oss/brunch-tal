import { readdirSync } from "node:fs"
import { fileURLToPath } from "node:url"

import { describe, expect, it } from "vitest"

import {
  exitHref,
  ga4InitScript,
  ga4Src,
  gtmScript,
  hasAnyTag,
  isPublicPath,
  marketingTagsView,
  metaPixelScript,
  normalizeTagId,
  startedPublic,
  tagProblem,
} from "./marketing-tags"

// Story 5.24: the formats, the public view and the leaving-the-area rules.

const NBSP = String.fromCharCode(160)

describe("normalizeTagId and tagProblem", () => {
  it("trims (also NBSP) and upper-cases; blank is null", () => {
    expect(normalizeTagId(" g-ab12cd34ef ")).toBe("G-AB12CD34EF")
    expect(normalizeTagId(`${NBSP}gtm-ab12cd3${NBSP}`)).toBe("GTM-AB12CD3")
    expect(normalizeTagId("   ")).toBeNull()
    expect(normalizeTagId("")).toBeNull()
    expect(normalizeTagId(null)).toBeNull()
  })

  it("removes the invisible format characters an RTL page adds", () => {
    const rlm = String.fromCharCode(0x200f)
    const lri = String.fromCharCode(0x2066)
    const pdi = String.fromCharCode(0x2069)
    const bom = String.fromCharCode(0xfeff)
    const zwsp = String.fromCharCode(0x200b)
    const rle = String.fromCharCode(0x202b)
    const pasted = `${rlm}${lri}G-AB12${zwsp}CD34EF${pdi}${rle}${bom}`
    expect(normalizeTagId(pasted)).toBe("G-AB12CD34EF")
    expect(tagProblem("ga4", pasted)).toBeNull()
    expect(normalizeTagId(`${rlm}${bom}`)).toBeNull()
  })

  it.each([
    ["ga4", " g-ab12cd34ef "],
    ["ga4", "G-ABCD"],
    ["gtm", "GTM-AB12CD3"],
    ["pixel", "123456789012345"],
    ["pixel", "1234567890"],
    ["ga4", ""],
    ["gtm", "  "],
  ] as const)("accepts %s %j", (field, value) => {
    expect(tagProblem(field, value)).toBeNull()
  })

  it.each([
    ["ga4", "<script>"],
    ["ga4", "G-ABC"],
    ["ga4", "UA-12345-1"],
    ["ga4", "G-AB12');alert(1);//"],
    ["gtm", "GTM-12 34"],
    ["gtm", "G-AB12CD34EF"],
    ["pixel", "12345"],
    ["pixel", "123456789012345678901"],
    ["pixel", "12345678901a"],
  ] as const)("refuses %s %j", (field, value) => {
    expect(tagProblem(field, value)).toBe("format")
  })
})

describe("marketingTagsView", () => {
  it("keeps valid IDs and turns an empty, invalid or missing one off", () => {
    expect(
      marketingTagsView({
        ga4_measurement_id: "G-AB12CD34EF",
        gtm_container_id: "gtm-ab12cd3",
        meta_pixel_id: "1'; alert(1)",
      })
    ).toEqual({ ga4: "G-AB12CD34EF", gtm: null, pixel: null })
    expect(marketingTagsView(null)).toEqual({
      ga4: null,
      gtm: null,
      pixel: null,
    })
    expect(hasAnyTag(marketingTagsView(null))).toBe(false)
    expect(hasAnyTag({ ga4: null, gtm: null, pixel: "1234567890" })).toBe(true)
  })
})

describe("the scripts", () => {
  it("are built only from a valid ID", () => {
    expect(ga4Src("G-AB12CD34EF")).toBe(
      "https://www.googletagmanager.com/gtag/js?id=G-AB12CD34EF"
    )
    expect(ga4InitScript("G-AB12CD34EF")).toContain(
      "gtag('config','G-AB12CD34EF')"
    )
    expect(gtmScript("GTM-AB12CD3")).toContain("'dataLayer','GTM-AB12CD3')")
    expect(gtmScript("GTM-AB12CD3")).toContain(
      "https://www.googletagmanager.com/gtm.js?id="
    )
    const pixel = metaPixelScript("123456789012345")
    expect(pixel).toContain("fbq('init','123456789012345')")
    // autoConfig off (no button-click or metadata events), before init.
    const autoConfig = pixel!.indexOf(
      "fbq('set','autoConfig',false,'123456789012345')"
    )
    expect(autoConfig).toBeGreaterThan(-1)
    expect(autoConfig).toBeLessThan(pixel!.indexOf("fbq('init',"))
    expect(pixel).toContain("fbq('track','PageView')")
    expect(pixel).toContain("https://connect.facebook.net/en_US/fbevents.js")
    for (const bad of ["G-AB'", "<script>", "", "g-ab12cd34ef"]) {
      expect(ga4Src(bad)).toBeNull()
      expect(ga4InitScript(bad)).toBeNull()
      expect(gtmScript(bad)).toBeNull()
      expect(metaPixelScript(bad)).toBeNull()
    }
  })

  it("send no custom events", () => {
    const all = [
      ga4InitScript("G-AB12CD34EF"),
      gtmScript("GTM-AB12CD3"),
      metaPixelScript("123456789012345"),
    ].join("\n")
    expect(all).not.toMatch(/gtag\('event'|fbq\('track(Custom)?','(?!PageView)/)
  })
})

describe("isPublicPath", () => {
  it.each([
    "/",
    "/sessions",
    "/sessions/abc",
    "/gallery",
    "/privacy",
    "/me-and-you",
    "/administer",
  ])("%s is public", (path) => {
    expect(isPublicPath(path)).toBe(true)
  })

  it.each([
    "/me",
    "/me/bookings",
    "/admin",
    "/admin/login",
    "/login",
    "/join/abc",
    "/reset/abc",
    "/offline",
    "/api/jobs/push",
  ])("%s is not public", (path) => {
    expect(isPublicPath(path)).toBe(false)
  })
})

// PRIVATE_PREFIXES must follow the routes: every first segment under app/
// (route groups expanded one level; (public) is the public site) is not
// public.
describe("the private prefixes cover every route outside (public)", () => {
  const appDir = fileURLToPath(new URL("../app/", import.meta.url))
  const dirs = (path: string) =>
    readdirSync(path, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .filter((name) => !name.startsWith("_") && !name.startsWith("@"))
  const segments: string[] = []
  for (const name of dirs(appDir)) {
    if (name === "(public)") continue
    if (/^\(.*\)$/.test(name)) segments.push(...dirs(`${appDir}${name}`))
    else segments.push(name)
  }

  it("finds the known ones", () => {
    for (const known of [
      "me",
      "admin",
      "api",
      "offline",
      "login",
      "join",
      "reset",
    ]) {
      expect(segments).toContain(known)
    }
  })

  it.each(segments)("/%s is not public", (segment) => {
    expect(isPublicPath(`/${segment}`)).toBe(false)
    expect(isPublicPath(`/${segment}/x`)).toBe(false)
  })
})

describe("startedPublic", () => {
  it("decides by the navigation entry's URL only", () => {
    expect(startedPublic("https://x/me")).toBe(false)
    expect(startedPublic("https://x/admin/login")).toBe(false)
    expect(startedPublic("https://x/sessions")).toBe(true)
    expect(startedPublic("https://x/")).toBe(true)
    expect(startedPublic(undefined)).toBe(false)
    expect(startedPublic("")).toBe(false)
    expect(startedPublic("not a url")).toBe(false)
  })
})

describe("exitHref", () => {
  const ORIGIN = "https://brunch.example"
  const plain = {
    button: 0,
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    defaultPrevented: false,
  }
  const link = (
    href: string,
    extra: Partial<{ target: string; download: boolean }> = {}
  ) => ({
    href,
    target: "",
    download: false,
    ...extra,
  })

  it("a plain click on a link out of the public area loads it in full", () => {
    expect(exitHref(plain, link(`${ORIGIN}/login`), ORIGIN)).toBe(
      `${ORIGIN}/login`
    )
    expect(exitHref(plain, link("/me?tab=1"), ORIGIN)).toBe(
      `${ORIGIN}/me?tab=1`
    )
    expect(exitHref(plain, link("/admin"), ORIGIN)).toBe(`${ORIGIN}/admin`)
  })

  it("leaves public links, other sites, new tabs and modified clicks alone", () => {
    expect(exitHref(plain, link("/sessions"), ORIGIN)).toBeNull()
    expect(
      exitHref(plain, link("https://wa.me/972500000000"), ORIGIN)
    ).toBeNull()
    expect(
      exitHref(plain, link("/me", { target: "_blank" }), ORIGIN)
    ).toBeNull()
    expect(exitHref(plain, link("/me", { download: true }), ORIGIN)).toBeNull()
    expect(
      exitHref({ ...plain, ctrlKey: true }, link("/me"), ORIGIN)
    ).toBeNull()
    expect(exitHref({ ...plain, button: 1 }, link("/me"), ORIGIN)).toBeNull()
    expect(
      exitHref({ ...plain, defaultPrevented: true }, link("/me"), ORIGIN)
    ).toBeNull()
    expect(exitHref(plain, null, ORIGIN)).toBeNull()
  })
})
