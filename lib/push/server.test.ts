import { beforeEach, describe, expect, it, vi } from "vitest"

import {
  isPushEndpoint,
  parsePushRegistration,
  registerPushSubscription,
  unregisterPushSubscription,
} from "./server"

const rpc = vi.fn()

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ rpc }),
}))

beforeEach(() => {
  rpc.mockReset()
  vi.spyOn(console, "error").mockImplementation(() => {})
})

// A real-shaped subscription: a 65-byte p256dh (87 base64url characters)
// and a 16-byte auth (22).
const P256DH =
  "BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U"
const AUTH = "tBHItJI5svbpez7KI4CCXg"
const ENDPOINT = "https://fcm.googleapis.com/fcm/send/abc-DEF_123:xyz"

function input(over: Record<string, unknown> = {}) {
  return {
    endpoint: ENDPOINT,
    keys: { p256dh: P256DH, auth: AUTH },
    platform: "android",
    ...over,
  }
}

describe("parsePushRegistration", () => {
  it("has the real key lengths", () => {
    expect(P256DH).toHaveLength(87)
    expect(AUTH).toHaveLength(22)
  })

  it.each(["ios", "android", "desktop", "other"])(
    "a real-shaped subscription on %s passes unchanged",
    (platform) => {
      expect(parsePushRegistration(input({ platform }))).toEqual({
        endpoint: ENDPOINT,
        keys: { p256dh: P256DH, auth: AUTH },
        platform,
      })
    }
  )

  it("drops anything beyond the shape", () => {
    expect(
      parsePushRegistration({
        ...input(),
        expirationTime: null,
        keys: { p256dh: P256DH, auth: AUTH, extra: "x" },
      })
    ).toEqual({
      endpoint: ENDPOINT,
      keys: { p256dh: P256DH, auth: AUTH },
      platform: "android",
    })
  })

  it.each<[string, unknown]>([
    ["not an object", "x"],
    ["null", null],
    ["an http endpoint", input({ endpoint: "http://push.example.test/a" })],
    [
      "an endpoint over 1000 characters",
      input({ endpoint: `https://push.example.test/${"a".repeat(1000)}` }),
    ],
    [
      "an endpoint with a space",
      input({ endpoint: "https://push.example.test/a b" }),
    ],
    ["no keys", input({ keys: undefined })],
    ["a non-string p256dh", input({ keys: { p256dh: 1, auth: AUTH } })],
    ["a non-string auth", input({ keys: { p256dh: P256DH, auth: null } })],
    [
      "bad characters in p256dh",
      input({ keys: { p256dh: "a+b/c", auth: AUTH } }),
    ],
    [
      "bad characters in auth",
      input({ keys: { p256dh: P256DH, auth: "a b" } }),
    ],
    ["an empty auth", input({ keys: { p256dh: P256DH, auth: "" } })],
    [
      "a p256dh over 200",
      input({ keys: { p256dh: "a".repeat(201), auth: AUTH } }),
    ],
    [
      "an auth over 100",
      input({ keys: { p256dh: P256DH, auth: "a".repeat(101) } }),
    ],
    ["an unknown platform", input({ platform: "windows" })],
    ["no platform", input({ platform: undefined })],
  ])("rejects %s", (_label, value) => {
    expect(parsePushRegistration(value)).toBeNull()
  })
})

describe("isPushEndpoint", () => {
  it.each<[unknown, boolean]>([
    [ENDPOINT, true],
    [`https://push.example.test/${"a".repeat(970)}`, true],
    [`https://push.example.test/${"a".repeat(1000)}`, false],
    ["http://push.example.test/a", false],
    ["", false],
    [null, false],
    [42, false],
  ])("%j -> %s", (value, expected) => {
    expect(isPushEndpoint(value)).toBe(expected)
  })
})

describe("registerPushSubscription", () => {
  it("calls the RPC with the parsed values -> ok", async () => {
    rpc.mockResolvedValue({ data: { registered: true }, error: null })
    expect(await registerPushSubscription(input({ platform: "ios" }))).toEqual({
      ok: true,
      data: undefined,
    })
    expect(rpc).toHaveBeenCalledWith("register_push_subscription", {
      p_endpoint: ENDPOINT,
      p_keys: { p256dh: P256DH, auth: AUTH },
      p_platform: "ios",
    })
  })

  it("a bad shape -> INVALID_INPUT without calling the RPC", async () => {
    expect(await registerPushSubscription(input({ platform: "x" }))).toEqual({
      ok: false,
      code: "INVALID_INPUT",
    })
    expect(rpc).not.toHaveBeenCalled()
  })

  it("a business error from the RPC is passed on", async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { code: "P0001", message: "NOT_AUTHORIZED" },
    })
    expect(await registerPushSubscription(input())).toEqual({
      ok: false,
      code: "NOT_AUTHORIZED",
    })
  })

  it("a network failure -> SERVER_ERROR", async () => {
    rpc.mockRejectedValue(new Error("fetch failed"))
    expect(await registerPushSubscription(input())).toEqual({
      ok: false,
      code: "SERVER_ERROR",
    })
  })
})

describe("unregisterPushSubscription", () => {
  it("calls the RPC with the endpoint -> ok", async () => {
    rpc.mockResolvedValue({ data: { removed: 1 }, error: null })
    expect(await unregisterPushSubscription(ENDPOINT)).toEqual({
      ok: true,
      data: undefined,
    })
    expect(rpc).toHaveBeenCalledWith("unregister_push_subscription", {
      p_endpoint: ENDPOINT,
    })
  })

  it("an invalid endpoint -> INVALID_INPUT without calling the RPC", async () => {
    expect(await unregisterPushSubscription("http://x")).toEqual({
      ok: false,
      code: "INVALID_INPUT",
    })
    expect(rpc).not.toHaveBeenCalled()
  })

  it("an RPC error is passed on", async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { code: "P0001", message: "NOT_AUTHORIZED" },
    })
    expect(await unregisterPushSubscription(ENDPOINT)).toEqual({
      ok: false,
      code: "NOT_AUTHORIZED",
    })
  })
})
