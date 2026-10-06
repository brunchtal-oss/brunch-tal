import { describe, expect, it } from "vitest"

import {
  isIos,
  platformOf,
  pushStateOf,
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
