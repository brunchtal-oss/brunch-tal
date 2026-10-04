import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import vm from "node:vm"

import { beforeEach, describe, expect, it } from "vitest"

import { WORDMARK } from "@/lib/copy/shell"

// Runs public/sw.js in a vm with fake self, caches, clients and fetch, and
// fires its events (story 5.9).

const SOURCE = readFileSync(
  fileURLToPath(new URL("../public/sw.js", import.meta.url)),
  "utf8"
)
const ORIGIN = "https://example.test"

type FakeRequest = { url: string; method: string; mode: string }
type Listener = (event: unknown) => void

const keyOf = (request: string | FakeRequest | Request) =>
  new URL(typeof request === "string" ? request : request.url, ORIGIN).href

class FakeCache {
  entries = new Map<string, Response>()
  async match(request: string | FakeRequest) {
    return this.entries.get(keyOf(request))?.clone()
  }
  async put(request: string | FakeRequest, response: Response) {
    this.entries.set(keyOf(request), response)
  }
}

class FakeCaches {
  stores = new Map<string, FakeCache>()
  async open(name: string) {
    if (!this.stores.has(name)) this.stores.set(name, new FakeCache())
    return this.stores.get(name)!
  }
  async keys() {
    return [...this.stores.keys()]
  }
  async delete(name: string) {
    return this.stores.delete(name)
  }
  /** Every cached URL path (with query), across caches. */
  paths() {
    return [...this.stores.values()].flatMap((cache) =>
      [...cache.entries.keys()].map((href) => {
        const url = new URL(href)
        return `${url.pathname}${url.search}`
      })
    )
  }
}

const OFFLINE_HTML = `<!doctype html><html><head>
<link rel="stylesheet" href="/_next/static/css/app.css?dpl=1&amp;x=2">
<script src="/_next/static/chunks/main.js" async></script>
</head><body><script>self.__next_f.push([1,"\\"/_next/static/chunks/page.js\\""])</script></body></html>`

let caches: FakeCaches
let listeners: Map<string, Listener>
let network: Map<string, () => Response>
let offline: boolean
let fetched: string[]
let notifications: { title: string; options: NotificationOptions }[]
let windows: {
  url: string
  focused: boolean
  navigated: string | null
  focus: () => Promise<unknown>
  navigate: (url: string) => Promise<unknown>
}[]
let opened: string[]
let skipped: boolean
let claimed: boolean

function load() {
  caches = new FakeCaches()
  listeners = new Map()
  fetched = []
  notifications = []
  windows = []
  opened = []
  skipped = false
  claimed = false
  offline = false
  network = new Map([
    ["/offline", () => new Response(OFFLINE_HTML, { status: 200 })],
    ["/_next/static/css/app.css?dpl=1&x=2", () => new Response("css")],
    ["/_next/static/chunks/main.js", () => new Response("js")],
    ["/_next/static/chunks/page.js", () => new Response("js")],
    ["/me", () => new Response("<html>me</html>")],
    ["/admin", () => new Response("<html>admin</html>")],
    ["/api/x", () => new Response("{}")],
    ["/icons/icon-192.png", () => new Response("png")],
    ["/_next/static/missing.js", () => new Response("no", { status: 404 })],
    ["/locked", () => new Response("locked", { status: 401 })],
    ["/broken", () => new Response("boom", { status: 500 })],
  ])

  const fakeFetch = async (request: string | FakeRequest) => {
    const url = new URL(keyOf(request))
    const path = `${url.pathname}${url.search}`
    fetched.push(path)
    if (offline) throw new TypeError("Failed to fetch")
    const make = network.get(path)
    return make ? make() : new Response("not found", { status: 404 })
  }

  const self = {
    location: { origin: ORIGIN },
    addEventListener: (type: string, listener: Listener) =>
      listeners.set(type, listener),
    skipWaiting: async () => {
      skipped = true
    },
    clients: {
      claim: async () => {
        claimed = true
      },
      matchAll: async () => windows,
      openWindow: async (url: string) => {
        opened.push(url)
        return null
      },
    },
    registration: {
      showNotification: async (title: string, options: NotificationOptions) => {
        notifications.push({ title, options })
      },
    },
  }

  vm.runInNewContext(SOURCE, {
    self,
    caches,
    fetch: fakeFetch,
    Response,
    URL,
    Set,
    Promise,
    Error,
    TypeError,
  })
}

/** Fires an event; resolves with what respondWith got (or undefined). */
async function fire(type: string, fields: Record<string, unknown> = {}) {
  const waits: Promise<unknown>[] = []
  let responded: Promise<Response> | undefined
  const event = {
    ...fields,
    waitUntil: (promise: Promise<unknown>) => waits.push(promise),
    respondWith: (promise: Promise<Response>) => {
      responded = promise
    },
  }
  listeners.get(type)!(event)
  await Promise.all(waits)
  return responded
}

const navigate = (path: string) =>
  fire("fetch", {
    request: { url: `${ORIGIN}${path}`, method: "GET", mode: "navigate" },
  })
const get = (path: string, origin = ORIGIN) =>
  fire("fetch", {
    request: { url: `${origin}${path}`, method: "GET", mode: "cors" },
  })

async function install() {
  await fire("install")
}

const pushData = (raw: string | null) =>
  raw === null
    ? null
    : {
        json: () => JSON.parse(raw),
      }

beforeEach(load)

describe("install and activate", () => {
  it("stores /offline and its static files, then skips waiting", async () => {
    await install()
    expect(caches.paths().sort()).toEqual(
      [
        "/offline",
        "/_next/static/css/app.css?dpl=1&x=2",
        "/_next/static/chunks/main.js",
        "/_next/static/chunks/page.js",
      ].sort()
    )
    expect(skipped).toBe(true)
  })

  it("fails the install when /offline is not a 200 (locked)", async () => {
    network.set("/offline", () => new Response("locked", { status: 401 }))
    await expect(install()).rejects.toThrow()
    expect(caches.paths()).toEqual([])
  })

  it("deletes older versions on activate and claims clients", async () => {
    await caches.open("brunch-v0")
    await caches.open("other-app")
    await install()
    await fire("activate")
    const names = await caches.keys()
    expect(names).not.toContain("brunch-v0")
    expect(names).toContain("other-app")
    expect(names.some((name) => name.startsWith("brunch-"))).toBe(true)
    expect(claimed).toBe(true)
  })
})

describe("fetch", () => {
  beforeEach(install)

  it("takes a navigation from the network and stores nothing", async () => {
    const before = caches.paths().length
    const response = await navigate("/me")
    expect(await response!.text()).toBe("<html>me</html>")
    expect(caches.paths()).toHaveLength(before)
  })

  it("answers a failed navigation with /offline from the cache", async () => {
    offline = true
    const response = await navigate("/me/bookings")
    expect(await response!.text()).toBe(OFFLINE_HTML)
  })

  it("answers Response.error() offline when /offline is not cached", async () => {
    caches.stores.clear()
    offline = true
    const response = await navigate("/me")
    expect(response!.type).toBe("error")
  })

  it.each([
    ["/locked", 401],
    ["/broken", 500],
  ])("passes %s through as it is (%i)", async (path, status) => {
    const response = await navigate(path)
    expect(response!.status).toBe(status)
    expect(caches.paths()).not.toContain(path)
  })

  it("serves a static file from the cache without the network", async () => {
    fetched = []
    const response = await get("/_next/static/chunks/main.js")
    expect(await response!.text()).toBe("js")
    expect(fetched).toEqual([])
  })

  it("fetches and stores a static file that is not cached", async () => {
    const response = await get("/icons/icon-192.png")
    expect(await response!.text()).toBe("png")
    expect(caches.paths()).toContain("/icons/icon-192.png")
  })

  it("does not store a static file that is not a 200", async () => {
    const response = await get("/_next/static/missing.js")
    expect(response!.status).toBe(404)
    expect(caches.paths()).not.toContain("/_next/static/missing.js")
  })

  it.each(["/api/x", "/me?_rsc=1", "/me", "/_next/static/a.js?_rsc=1"])(
    "does not respond to %s (not a navigation)",
    async (path) => {
      expect(await get(path)).toBeUndefined()
    }
  )

  it("ignores another origin and a non-GET", async () => {
    expect(
      await get("/_next/static/chunks/main.js", "https://cdn.test")
    ).toBeUndefined()
    expect(
      await fire("fetch", {
        request: {
          url: `${ORIGIN}/_next/static/chunks/main.js`,
          method: "POST",
          mode: "cors",
        },
      })
    ).toBeUndefined()
  })

  it("after /me, /admin and /api holds only /offline, /_next/static and /icons", async () => {
    await navigate("/me")
    await navigate("/admin")
    await get("/api/x")
    await get("/me?_rsc=1")
    await get("/icons/icon-192.png")
    offline = true
    await navigate("/admin")
    for (const path of caches.paths()) {
      expect(path).toMatch(/^\/(offline$|_next\/static\/|icons\/)/)
    }
    expect(caches.paths()).toContain("/offline")
  })
})

describe("push", () => {
  it("shows the payload's title and body, with target_path in data", async () => {
    await fire("push", {
      data: pushData(
        JSON.stringify({ title: "t", body: "b", target_path: "/me/bookings" })
      ),
    })
    expect(notifications).toHaveLength(1)
    expect(notifications[0].title).toBe("t")
    expect(notifications[0].options).toMatchObject({
      body: "b",
      lang: "he",
      dir: "rtl",
      data: { target_path: "/me/bookings" },
    })
  })

  it.each([
    ["no data", null],
    ["not JSON", "not json"],
    ["JSON without a title", JSON.stringify({ body: "b" })],
    ["a JSON string", JSON.stringify("x")],
  ])("shows the WORDMARK with %s", async (_label, raw) => {
    await fire("push", { data: pushData(raw) })
    expect(notifications).toHaveLength(1)
    expect(notifications[0].title).toBe(WORDMARK)
  })

  it.each(["https://evil.test/me", "//evil.test", "/meeting", "/sessions", 42])(
    "keeps the target at / for %s",
    async (target) => {
      await fire("push", {
        data: pushData(JSON.stringify({ title: "t", target_path: target })),
      })
      expect(notifications[0].options.data).toEqual({ target_path: "/" })
    }
  )
})

describe("notificationclick", () => {
  const click = (target: unknown) => {
    let closed = false
    const done = fire("notificationclick", {
      notification: {
        data: { target_path: target },
        close: () => {
          closed = true
        },
      },
    })
    return done.then(() => closed)
  }

  function openWindow() {
    const win = {
      url: `${ORIGIN}/`,
      focused: false,
      navigated: null as string | null,
      focus: async () => {
        win.focused = true
        return win
      },
      navigate: async (url: string) => {
        win.navigated = url
        return win
      },
    }
    windows.push(win)
    return win
  }

  it("opens a new window at target_path when none is open", async () => {
    expect(await click("/me/bookings")).toBe(true)
    expect(opened).toEqual([`${ORIGIN}/me/bookings`])
  })

  it("moves an open window to target_path", async () => {
    const win = openWindow()
    await click("/admin/customers")
    expect(win.focused).toBe(true)
    expect(win.navigated).toBe(`${ORIGIN}/admin/customers`)
    expect(opened).toEqual([])
  })

  it.each(["https://evil.test", "/elsewhere", undefined])(
    "opens / for %s",
    async (target) => {
      await click(target)
      expect(opened).toEqual([`${ORIGIN}/`])
    }
  )

  it("opens a window when the open one cannot be navigated", async () => {
    const win = openWindow()
    win.navigate = async () => {
      throw new TypeError("not controlled")
    }
    await click("/me")
    expect(opened).toEqual([`${ORIGIN}/me`])
  })
})
