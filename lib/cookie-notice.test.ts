import { readdirSync, readFileSync } from "node:fs"
import { join, sep } from "node:path"

import { afterEach, describe, expect, it, vi } from "vitest"

import {
  COOKIE_NOTICE_KEY,
  cookieNoticeView,
  hasCookieAck,
  isAckValid,
  linkSeparator,
  resetCookieAckForTest,
  saveCookieAck,
  subscribe,
} from "./cookie-notice"

const DAY = 24 * 60 * 60 * 1000
const NOW = Date.parse("2026-10-28T09:00:00.000Z")

// A window whose localStorage is a Map, or throws.
function stubWindow(storage: Partial<Storage>) {
  const target = new EventTarget() as EventTarget & { localStorage: unknown }
  target.localStorage = storage
  vi.stubGlobal("window", target)
  return target
}

function mapStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial))
  return {
    map,
    storage: {
      getItem: (key: string) => map.get(key) ?? null,
      setItem: (key: string, value: string) => void map.set(key, value),
    },
  }
}

const throwing = () => {
  throw new Error("blocked")
}

describe("cookie notice choice", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
    resetCookieAckForTest()
  })

  it("documents the key", () => {
    expect(COOKIE_NOTICE_KEY).toBe("cookie_notice_ack")
  })

  it.each([
    [null, false],
    ["", false],
    ["not a date", false],
    [new Date(NOW - 366 * DAY).toISOString(), false],
    [new Date(NOW - 365 * DAY).toISOString(), true],
    [new Date(NOW + DAY).toISOString(), false],
    [new Date(NOW - DAY).toISOString(), true],
  ])("isAckValid(%j) is %s", (value, valid) => {
    expect(isAckValid(value, NOW)).toBe(valid)
  })

  it("is not acked without a key, and acked after the click", () => {
    vi.useFakeTimers({ now: NOW })
    const { map, storage } = mapStorage()
    stubWindow(storage)
    expect(hasCookieAck()).toBe(false)
    saveCookieAck()
    expect(map.get(COOKIE_NOTICE_KEY)).toBe(new Date(NOW).toISOString())
    resetCookieAckForTest()
    expect(hasCookieAck()).toBe(true)
  })

  it("shows the notice again for a choice 366 days old", () => {
    vi.useFakeTimers({ now: NOW })
    const old = new Date(NOW - 366 * DAY).toISOString()
    stubWindow(mapStorage({ [COOKIE_NOTICE_KEY]: old }).storage)
    expect(hasCookieAck()).toBe(false)
  })

  it("shows the notice when reading the storage throws", () => {
    stubWindow({ getItem: throwing, setItem: throwing })
    expect(hasCookieAck()).toBe(false)
  })

  it("closes for this page load when the write throws", () => {
    stubWindow({ getItem: throwing, setItem: throwing })
    expect(() => saveCookieAck()).not.toThrow()
    expect(hasCookieAck()).toBe(true)
  })

  it("tells the subscribers of a click and of another tab", () => {
    const target = stubWindow(mapStorage().storage)
    const onChange = vi.fn()
    const unsubscribe = subscribe(onChange)
    saveCookieAck()
    target.dispatchEvent(new Event("storage"))
    expect(onChange).toHaveBeenCalledTimes(2)
    unsubscribe()
    saveCookieAck()
    target.dispatchEvent(new Event("storage"))
    expect(onChange).toHaveBeenCalledTimes(2)
  })
})

describe("linkSeparator", () => {
  it.each(["ב", "ל", "מ", "ו", "ה", "כ", "ש"])(
    "joins the link to the prefix %s",
    (prefix) => {
      expect(linkSeparator(`אפשר לעיין ${prefix}`)).toBe("")
    }
  )

  it.each([
    ["למידע נוסף ראו", " "],
    ["אפשר לעיין ב ", ""],
    ["לעיין בב", " "],
    ["ב", ""],
    ["", " "],
  ])("after %j the separator is %j", (body, separator) => {
    expect(linkSeparator(body)).toBe(separator)
  })
})

describe("cookieNoticeView", () => {
  const content = { title: "t", body: "b", link_label: "l" }

  it("is null without a title and a body", () => {
    expect(cookieNoticeView(null, true)).toBeNull()
    expect(cookieNoticeView({}, true)).toBeNull()
    expect(cookieNoticeView({ title: " ", link_label: "l" }, true)).toBeNull()
  })

  it("shows the link only with a label and a published privacy policy", () => {
    expect(cookieNoticeView(content, true)).toEqual({
      title: "t",
      body: "b",
      linkLabel: "l",
    })
    expect(cookieNoticeView(content, false)?.linkLabel).toBeUndefined()
    expect(
      cookieNoticeView({ body: "b", link_label: " " }, true)?.linkLabel
    ).toBeUndefined()
  })

  it("is shown with a title only or a body only", () => {
    expect(cookieNoticeView({ title: "t" }, false)).toEqual({ title: "t" })
    expect(cookieNoticeView({ body: "b" }, false)).toEqual({ body: "b" })
  })
})

// Only the public site shows the notice (not /login, /me, /admin, /join or
// /offline): the live component is rendered by app/(public)/layout.tsx
// alone; the admin preview renders only the static panel.
describe("where the notice is shown", () => {
  function files(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) return files(path)
      return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)
        ? [path]
        : []
    })
  }

  it("renders <CookieNotice> only in the public layout", () => {
    const users = files("app")
      .filter((path) => /<CookieNotice[\s/>]/.test(readFileSync(path, "utf8")))
      .map((path) => path.split(sep).join("/"))
    expect(users).toEqual(["app/(public)/layout.tsx"])
  })
})
