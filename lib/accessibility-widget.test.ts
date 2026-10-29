import { readdirSync, statSync } from "node:fs"
import { join, relative, sep } from "node:path"
import { fileURLToPath } from "node:url"

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  configHasSettings,
  hasSavedSettings,
  loadWidget,
  resetWidgetLoaderForTests,
  showsAccessibilityButton,
  stripDevParam,
  widgetOptions,
  widgetReady,
  widgetRequested,
} from "./accessibility-widget"

const APP = fileURLToPath(new URL("../app", import.meta.url))

function pages(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) return pages(full)
    return name === "page.tsx" ? [full] : []
  })
}

// app/(auth)/admin/login/page.tsx -> { url: "/admin/login", admin: true }
function route(file: string) {
  const segments = relative(APP, file).split(sep).slice(0, -1)
  const admin = segments.filter((s) => !/^\(.*\)$/.test(s))[0] === "admin"
  const url =
    "/" +
    segments
      .filter((s) => !/^\(.*\)$/.test(s))
      .map((s) => (s.startsWith("[") ? "x" : s))
      .join("/")
  return { url, admin }
}

describe("showsAccessibilityButton", () => {
  const all = pages(APP).map(route)

  it("walks the app's pages", () => {
    expect(all.length).toBeGreaterThan(20)
    expect(all.some((r) => r.url === "/admin/login")).toBe(true)
    expect(all.some((r) => r.url === "/me")).toBe(true)
  })

  it.each(all.map((r) => [r.url, !r.admin] as const))(
    "%s -> %s",
    (url, expected) => {
      expect(showsAccessibilityButton(url)).toBe(expected)
    }
  )

  it.each([
    ["/", true],
    ["/sessions", true],
    ["/login", true],
    ["/join/abc", true],
    ["/reset/abc", true],
    ["/offline", true],
    ["/me/bookings", true],
    ["/no-such-page", true],
    ["/administrator", true],
    ["/admin", false],
    ["/admin/", false],
    ["/admin/login", false],
    ["/admin/sessions", false],
    ["/api/push", false],
  ])("%s -> %s", (url, expected) => {
    expect(showsAccessibilityButton(url)).toBe(expected)
  })
})

describe("configHasSettings", () => {
  it.each([
    [null, false],
    ["", false],
    ["not json", false],
    ["{}", false],
    ['{"states":{}}', false],
    ['{"states":{"text-scale":1}}', false],
    ['{"states":{"text-scale":false,"bold-text":false}}', false],
    ['{"states":{"text-scale":1.2}}', true],
    ['{"states":{"high-contrast":true}}', true],
    ['{"lang":"en"}', false],
  ])("%s -> %s", (raw, expected) => {
    expect(configHasSettings(raw)).toBe(expected)
  })
})

describe("hasSavedSettings", () => {
  afterEach(() => vi.unstubAllGlobals())

  it("reads localStorage", () => {
    vi.stubGlobal("window", {
      localStorage: { getItem: () => '{"states":{"bold-text":true}}' },
    })
    vi.stubGlobal("document", { cookie: "" })
    expect(hasSavedSettings()).toBe(true)
  })

  it("falls back to the cookie when localStorage throws", () => {
    vi.stubGlobal("window", {
      localStorage: {
        getItem: () => {
          throw new Error("blocked")
        },
      },
    })
    vi.stubGlobal("document", {
      cookie: `a=1; accweb=${encodeURIComponent('{"states":{"bold-text":true}}')}`,
    })
    expect(hasSavedSettings()).toBe(true)
  })

  it("nothing saved", () => {
    vi.stubGlobal("window", { localStorage: { getItem: () => null } })
    vi.stubGlobal("document", { cookie: "a=1" })
    expect(hasSavedSettings()).toBe(false)
  })
})

describe("widgetOptions", () => {
  const options = widgetOptions()

  it("Hebrew, our button, no attribution", () => {
    expect(options).toMatchObject({
      lang: "he",
      position: "bottom-left",
      hideButton: true,
      hideAttribution: true,
    })
  })

  it("only same-origin URLs (fonts, axe-core)", () => {
    const urls = [
      ...Object.values(options.readableFontUrls),
      options.axeCoreUrl,
    ]
    expect(urls).toHaveLength(4)
    for (const url of urls) expect(url).toMatch(/^\/fonts\/a11y\//)
  })

  it("DESIGN.md colours", () => {
    expect(options).toMatchObject({
      primaryColor: "#4A4A2A",
      primaryColorDark: "#2E2A1F",
      activeColor: "#2E2A1F",
      primaryColorLight: "#6B6450",
      hoverColor: "#6B6450",
      backgroundColor: "#FAF6EE",
      cardBackground: "#FFFDF8",
      textColor: "#2E2A1F",
      textColorInverted: "#FAF6EE",
      borderColor: "#E6DFCF",
      focusRingColor: "#4A4A2A",
      buttonBorderRadius: "4px",
      borderRadius: "8px",
    })
  })
})

describe("stripDevParam", () => {
  it.each([
    ["https://x.test/?acc-dev=true", "https://x.test/"],
    ["https://x.test/me?a=1&acc-dev=true#h", "https://x.test/me?a=1#h"],
    ["https://x.test/me?a=1", null],
  ])("%s -> %s", (href, expected) => {
    expect(stripDevParam(href)).toBe(expected)
  })
})

describe("loadWidget", () => {
  const open = vi.fn(() => true)
  let replaceState: ReturnType<typeof vi.fn>
  let win: Record<string, unknown>

  beforeEach(() => {
    resetWidgetLoaderForTests()
    replaceState = vi.fn()
    win = {
      location: { href: "https://x.test/?acc-dev=true" },
      history: { state: { s: 1 }, replaceState },
    }
    vi.stubGlobal("window", win)
  })
  afterEach(() => vi.unstubAllGlobals())

  it("removes acc-dev and sets the options before the import, once", async () => {
    const importer = vi.fn(async () => {
      expect(replaceState).toHaveBeenCalledWith({ s: 1 }, "", "https://x.test/")
      expect(win.AccessibleWebWidgetOptions).toEqual(widgetOptions())
      win.AccessibleWebWidget = { instance: { open } }
    })
    expect(widgetRequested()).toBe(false)
    const instance = await loadWidget(importer)
    expect(instance.open()).toBe(true)
    expect(widgetReady()).toBe(true)
    await loadWidget(importer)
    expect(importer).toHaveBeenCalledTimes(1)
  })

  it("a failed import is forgotten, so the next call retries", async () => {
    const failing = vi.fn(async () => {
      throw new Error("offline")
    })
    await expect(loadWidget(failing)).rejects.toThrow("offline")
    expect(widgetRequested()).toBe(false)
    expect(widgetReady()).toBe(false)
    const importer = vi.fn(async () => {
      win.AccessibleWebWidget = { instance: { open } }
    })
    await expect(loadWidget(importer)).resolves.toBeDefined()
  })
})
