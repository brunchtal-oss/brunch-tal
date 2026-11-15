import { afterEach, describe, expect, it, vi } from "vitest"

import {
  ensureSubscription,
  forgetReplaced,
  isIos,
  sameKey,
  platformOf,
  pushStateOf,
  shouldOffer,
  shouldOfferOnWaitlist,
  urlBase64ToUint8Array,
  type PushEnv,
} from "./client"

const IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1"
const IPAD_DESKTOP_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15"
const ANDROID =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36"
const WINDOWS =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36"

const BASE: PushEnv = {
  supported: true,
  permission: "default",
  ios: false,
  standalone: false,
  choice: null,
}

describe("pushStateOf", () => {
  it.each<[string, Partial<PushEnv>, string]>([
    ["not asked yet", {}, "ask"],
    ["granted", { permission: "granted" }, "on"],
    [
      "granted, turned off here",
      { permission: "granted", choice: "off" },
      "off",
    ],
    ["'not now'", { choice: "off" }, "off"],
    ["blocked", { permission: "denied" }, "denied"],
    [
      "blocked wins over 'not now'",
      { permission: "denied", choice: "off" },
      "denied",
    ],
    ["no Push API", { supported: false }, "unsupported"],
    ["no Notification", { permission: null }, "unsupported"],
    [
      "iPhone in Safari",
      { ios: true, supported: false, permission: null },
      "ios-install",
    ],
    ["iPhone home-screen app", { ios: true, standalone: true }, "ask"],
    [
      "old iPhone home-screen app without push",
      { ios: true, standalone: true, supported: false, permission: null },
      "unsupported",
    ],
  ])("%s -> %s", (_label, env, expected) => {
    expect(pushStateOf({ ...BASE, ...env })).toBe(expected)
  })
})

describe("platformOf", () => {
  it.each([
    [IPHONE, 5, "ios"],
    [IPAD_DESKTOP_UA, 5, "ios"],
    [IPAD_DESKTOP_UA, 0, "desktop"],
    [ANDROID, 5, "android"],
    [WINDOWS, 0, "desktop"],
    ["SomethingElse/1.0", 0, "other"],
  ])("%s (%i touch points) -> %s", (ua, touch, expected) => {
    expect(platformOf(ua, touch)).toBe(expected)
    expect(isIos(ua, touch)).toBe(expected === "ios")
  })
})

describe("urlBase64ToUint8Array", () => {
  it("decodes base64url without padding into a fresh buffer", () => {
    // "hello?>" in base64url: aGVsbG8_Pg (no padding, '_' for '/').
    const bytes = urlBase64ToUint8Array("aGVsbG8_Pg")
    expect(Array.from(bytes)).toEqual([104, 101, 108, 108, 111, 63, 62])
    expect(bytes.buffer).toBeInstanceOf(ArrayBuffer)
    expect(bytes.byteLength).toBe(bytes.buffer.byteLength)
  })

  it("decodes a 65-byte VAPID public key", () => {
    const key =
      "BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U"
    expect(urlBase64ToUint8Array(key)).toHaveLength(65)
  })
})

// Story 5.21: the push offer after a booking, once per device.
describe("shouldOffer", () => {
  const storage = (value: string | null) => ({ getItem: () => value })

  it("asks only while the device is 'ask' and was never offered", () => {
    expect(shouldOffer("ask", storage(null))).toBe(true)
    expect(shouldOffer("ask", storage("1"))).toBe(false)
  })

  it.each(["off", "denied", "unsupported", "ios-install", "on"] as const)(
    "never when the device is %s",
    (state) => {
      expect(shouldOffer(state, storage(null))).toBe(false)
    }
  )

  it("storage that is missing or throws: no offer", () => {
    expect(shouldOffer("ask", null)).toBe(false)
    expect(
      shouldOffer("ask", {
        getItem: () => {
          throw new Error("blocked")
        },
      })
    ).toBe(false)
  })
})

describe("shouldOfferOnWaitlist (story 5.6)", () => {
  const storage = (value: string | null) => ({ getItem: () => value })

  it("asks while 'ask' or 'off' (also after 'לא עכשיו' in the center)", () => {
    expect(shouldOfferOnWaitlist("ask", storage(null))).toBe(true)
    expect(shouldOfferOnWaitlist("off", storage(null))).toBe(true)
  })

  it("never again after 'לא עכשיו' to this offer", () => {
    expect(shouldOfferOnWaitlist("ask", storage("1"))).toBe(false)
    expect(shouldOfferOnWaitlist("off", storage("1"))).toBe(false)
  })

  it.each(["denied", "unsupported", "ios-install", "on"] as const)(
    "never when the device is %s",
    (state) => {
      expect(shouldOfferOnWaitlist(state, storage(null))).toBe(false)
    }
  )

  it("storage that is missing or throws: no offer", () => {
    expect(shouldOfferOnWaitlist("ask", null)).toBe(false)
    expect(
      shouldOfferOnWaitlist("ask", {
        getItem: () => {
          throw new Error("blocked")
        },
      })
    ).toBe(false)
  })
})

// fix-push-key-change: a subscription made with another VAPID key (prod
// switched pairs in 6.1) answered 403 forever; it is made again.
const KEY = "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQ"
const OLD_KEY = "BOldOldOldOldOldOldOldOldOldOldOldOldOldOld"

function bufferOf(base64: string): ArrayBuffer {
  return urlBase64ToUint8Array(base64).buffer
}

function fakeSub(endpoint: string, key: ArrayBuffer | null) {
  return {
    endpoint,
    options: { applicationServerKey: key },
    unsubscribe: vi.fn(async () => true),
    toJSON: () => ({ endpoint, keys: { p256dh: "p", auth: "a" } }),
  }
}

function device(existing: ReturnType<typeof fakeSub> | null) {
  const fresh = fakeSub("https://fcm.googleapis.com/fcm/send/new", null)
  const pushManager = {
    getSubscription: vi.fn(async () => existing),
    subscribe: vi.fn(async () => fresh),
  }
  const reg = { pushManager }
  vi.stubGlobal("navigator", {
    userAgent: ANDROID,
    maxTouchPoints: 5,
    serviceWorker: {
      getRegistration: async () => reg,
      ready: Promise.resolve(reg),
    },
  })
  const stored = new Map<string, string>()
  vi.stubGlobal("window", {
    dispatchEvent: vi.fn(),
    localStorage: {
      getItem: (k: string) => stored.get(k) ?? null,
      setItem: (k: string, v: string) => void stored.set(k, v),
      removeItem: (k: string) => void stored.delete(k),
    },
  })
  vi.stubEnv("NEXT_PUBLIC_VAPID_PUBLIC_KEY", KEY)
  return Object.assign(pushManager, { stored })
}

describe("sameKey", () => {
  const current = urlBase64ToUint8Array(KEY)
  it("true for the same bytes, false for others, null when not exposed", () => {
    expect(sameKey(bufferOf(KEY), current)).toBe(true)
    expect(sameKey(bufferOf(OLD_KEY), current)).toBe(false)
    expect(sameKey(new ArrayBuffer(3), current)).toBe(false)
    expect(sameKey(null, current)).toBeNull()
  })
})

describe("ensureSubscription", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })

  it("same key: keeps the subscription", async () => {
    const old = fakeSub(
      "https://fcm.googleapis.com/fcm/send/old",
      bufferOf(KEY)
    )
    const pm = device(old)
    const out = await ensureSubscription()
    expect(old.unsubscribe).not.toHaveBeenCalled()
    expect(pm.subscribe).not.toHaveBeenCalled()
    expect(out).toEqual({
      registration: {
        endpoint: old.endpoint,
        keys: { p256dh: "p", auth: "a" },
        platform: "android",
      },
      replaced: null,
    })
  })

  it("another key: unsubscribes, subscribes with the current key, returns the old endpoint", async () => {
    const old = fakeSub(
      "https://fcm.googleapis.com/fcm/send/old",
      bufferOf(OLD_KEY)
    )
    const pm = device(old)
    const out = await ensureSubscription()
    expect(old.unsubscribe).toHaveBeenCalledTimes(1)
    expect(pm.subscribe).toHaveBeenCalledTimes(1)
    const [{ applicationServerKey }] = pm.subscribe.mock
      .calls[0] as unknown as [{ applicationServerKey: Uint8Array }]
    expect([...applicationServerKey]).toEqual([...urlBase64ToUint8Array(KEY)])
    expect(out?.registration.endpoint).toBe(
      "https://fcm.googleapis.com/fcm/send/new"
    )
    expect(out?.replaced).toBe(old.endpoint)
  })

  it("another key, the browser gives the same endpoint back: nothing to remove", async () => {
    const old = fakeSub(
      "https://fcm.googleapis.com/fcm/send/new",
      bufferOf(OLD_KEY)
    )
    device(old)
    const out = await ensureSubscription()
    expect(old.unsubscribe).toHaveBeenCalledTimes(1)
    expect(out?.replaced).toBeNull()
  })

  it("key not exposed (null): keeps the subscription", async () => {
    const old = fakeSub("https://fcm.googleapis.com/fcm/send/old", null)
    const pm = device(old)
    const out = await ensureSubscription()
    expect(old.unsubscribe).not.toHaveBeenCalled()
    expect(pm.subscribe).not.toHaveBeenCalled()
    expect(out?.registration.endpoint).toBe(old.endpoint)
    expect(out?.replaced).toBeNull()
  })

  it("no subscription: subscribes, nothing replaced", async () => {
    const pm = device(null)
    const out = await ensureSubscription()
    expect(pm.subscribe).toHaveBeenCalledTimes(1)
    expect(out?.replaced).toBeNull()
  })

  it("subscribe fails after unsubscribe: the old endpoint is kept and returned by the next call until forgotten", async () => {
    const old = fakeSub(
      "https://fcm.googleapis.com/fcm/send/old",
      bufferOf(OLD_KEY)
    )
    const pm = device(old)
    pm.subscribe.mockRejectedValueOnce(new Error("AbortError"))
    await expect(ensureSubscription()).rejects.toThrow()
    expect(pm.stored.get("push-replaced")).toBe(old.endpoint)

    // Next sync: the browser has no subscription now.
    pm.getSubscription.mockResolvedValue(null)
    const out = await ensureSubscription()
    expect(out?.registration.endpoint).toBe(
      "https://fcm.googleapis.com/fcm/send/new"
    )
    expect(out?.replaced).toBe(old.endpoint)
    // Still kept until the caller removed it from the server.
    expect((await ensureSubscription())?.replaced).toBe(old.endpoint)
    forgetReplaced()
    expect((await ensureSubscription())?.replaced).toBeNull()
  })
})
