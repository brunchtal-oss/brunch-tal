import { beforeEach, describe, expect, it, vi } from "vitest"

import {
  closedPathFor,
  confirmCheckout,
  parseCheckoutCookie,
  returnPathFor,
  startCheckout,
  type CheckoutDeps,
} from "./checkout"
import { GrowUnavailableError, type GrowClient } from "./grow"

const serviceRpc = vi.fn()
const sessionRpc = vi.fn()
const cookieSet = vi.fn()
const hitRateLimit = vi.fn()

vi.mock("@/lib/server/privileged/service-client", () => ({
  createServiceClient: () => ({ rpc: serviceRpc }),
}))
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ rpc: sessionRpc }),
}))
vi.mock("next/headers", () => ({
  cookies: async () => ({ set: cookieSet }),
}))
vi.mock("@/lib/server/join-link", () => ({
  requestOrigin: async () => "https://site.test",
}))
vi.mock("@/lib/server/privileged/rate-limit", () => ({
  clientIp: async () => "203.0.113.7",
  hitRateLimit: (...args: unknown[]) => hitRateLimit(...args),
  rateLimitCode: (verdict: string) =>
    verdict === "allowed"
      ? null
      : verdict === "blocked"
        ? "TOO_MANY_ATTEMPTS"
        : "SERVER_ERROR",
}))

const ENV = {
  ONLINE_PAYMENTS_ENABLED: "true",
  GROW_ENV: "sandbox",
  GROW_CLIENT_ID: "id",
  GROW_CLIENT_SECRET: "secret",
  GROW_PLUGIN_ID: "plugin",
  GROW_DOCUMENT_TYPE: "400",
}

const CHECKOUT = "11111111-1111-4111-8111-111111111111"
const PRODUCT = "22222222-2222-4222-8222-222222222222"
const EVENT = "33333333-3333-4333-8333-333333333333"
const KEY = "44444444-4444-4444-8444-444444444444"
const NOTIFY = "n".repeat(43)
const BROWSER = "b".repeat(43)

const createPaymentForm = vi.fn()
const findCheckoutDocument = vi.fn()
const deps: CheckoutDeps = {
  env: ENV,
  grow: () =>
    ({ createPaymentForm, findCheckoutDocument }) as unknown as GrowClient,
}

const ok = (data: unknown) => ({ data, error: null })
const p0001 = (code: string) => ({
  data: null,
  error: { code: "P0001", message: code },
})

const BEGUN = {
  checkout_id: CHECKOUT,
  reference: "BT-1111111111",
  amount_agorot: 47200,
  product_name: "כרטיסייה",
  product_kind: "days",
  event_id: null,
  pay_until: "2026-11-20T10:10:00Z",
  notify_secret: NOTIFY,
  browser_secret: BROWSER,
  reissue_required: false,
}

beforeEach(() => {
  vi.clearAllMocks()
  hitRateLimit.mockResolvedValue("allowed")
})

const customerInput = {
  as: "customer" as const,
  productId: PRODUCT,
  eventId: null,
  termsAccepted: true,
  idempotencyKey: KEY,
}

describe("startCheckout", () => {
  it("kill switch off: ONLINE_PAYMENTS_OFF and no row", async () => {
    const result = await startCheckout(customerInput, {
      ...deps,
      env: { ...ENV, ONLINE_PAYMENTS_ENABLED: "false" },
    })
    expect(result).toEqual({ ok: false, code: "ONLINE_PAYMENTS_OFF" })
    expect(sessionRpc).not.toHaveBeenCalled()
    expect(serviceRpc).not.toHaveBeenCalled()
  })

  it("a customer: begin_checkout on her session, the form, the cookie", async () => {
    sessionRpc.mockResolvedValue(ok(BEGUN))
    createPaymentForm.mockResolvedValue("https://pay.test/form")

    const result = await startCheckout(customerInput, deps)

    expect(result).toEqual({
      ok: true,
      data: { kind: "redirect", url: "https://pay.test/form" },
    })
    expect(sessionRpc).toHaveBeenCalledWith("begin_checkout", {
      p_product_id: PRODUCT,
      p_event_id: null,
      p_terms_accepted: true,
      p_idempotency_key: KEY,
    })
    expect(hitRateLimit).not.toHaveBeenCalled()
    const form = createPaymentForm.mock.calls[0][0]
    expect(form).toMatchObject({
      description: "כרטיסייה · BT-1111111111",
      amountAgorot: 47200,
      successUrl: "https://site.test/pay/return",
      failureUrl: "https://site.test/pay/failed",
      custom: CHECKOUT,
    })
    const notify = new URL(form.notifyUrl)
    expect(notify.origin + notify.pathname).toBe(
      "https://site.test/api/payments/grow"
    )
    expect(notify.searchParams.get("c")).toBe(CHECKOUT)
    expect(notify.searchParams.get("s")).toBe(NOTIFY)
    expect(cookieSet).toHaveBeenCalledWith(
      "bt_checkout",
      `${CHECKOUT}.${BROWSER}`,
      expect.objectContaining({
        httpOnly: true,
        secure: true,
        sameSite: "lax",
        maxAge: 60 * 60 * 24 * 7,
      })
    )
  })

  it("a guest: the checkout rate limit by IP, then the service role", async () => {
    serviceRpc.mockResolvedValue(ok({ ...BEGUN, event_id: EVENT }))
    createPaymentForm.mockResolvedValue("https://pay.test/form")

    const result = await startCheckout(
      { ...customerInput, as: "guest", eventId: EVENT },
      deps
    )

    expect(result.ok).toBe(true)
    expect(hitRateLimit).toHaveBeenCalledWith("checkout", {
      ip: "203.0.113.7",
      id: "203.0.113.7",
    })
    expect(serviceRpc).toHaveBeenCalledWith(
      "begin_guest_checkout",
      expect.objectContaining({ p_event_id: EVENT })
    )
  })

  it("a guest over the limit: TOO_MANY_ATTEMPTS, no row", async () => {
    hitRateLimit.mockResolvedValue("blocked")
    const result = await startCheckout({ ...customerInput, as: "guest" }, deps)
    expect(result).toEqual({ ok: false, code: "TOO_MANY_ATTEMPTS" })
    expect(serviceRpc).not.toHaveBeenCalled()
  })

  it("a business code of the RPC comes back as is", async () => {
    sessionRpc.mockResolvedValue(p0001("EVENT_FULL"))
    expect(await startCheckout(customerInput, deps)).toEqual({
      ok: false,
      code: "EVENT_FULL",
    })
    expect(createPaymentForm).not.toHaveBeenCalled()
  })

  it("a replayed key: no form, no cookie", async () => {
    const { notify_secret, browser_secret, ...stored } = BEGUN
    void notify_secret
    void browser_secret
    sessionRpc.mockResolvedValue(ok({ ...stored, reissue_required: true }))
    expect(await startCheckout(customerInput, deps)).toEqual({
      ok: true,
      data: { kind: "replayed" },
    })
    expect(createPaymentForm).not.toHaveBeenCalled()
    expect(cookieSet).not.toHaveBeenCalled()
  })

  it("Grow fails: cancel_checkout releases the hold, GROW_UNAVAILABLE", async () => {
    sessionRpc.mockResolvedValue(ok(BEGUN))
    createPaymentForm.mockRejectedValue(
      new GrowUnavailableError("payment_form", 503)
    )
    serviceRpc.mockResolvedValue(ok({ state: "failed" }))

    expect(await startCheckout(customerInput, deps)).toEqual({
      ok: false,
      code: "GROW_UNAVAILABLE",
    })
    expect(serviceRpc).toHaveBeenCalledWith("cancel_checkout", {
      p_checkout_id: CHECKOUT,
      p_browser_secret: BROWSER,
    })
    expect(cookieSet).not.toHaveBeenCalled()
  })

  it("a malformed id is INVALID_INPUT before any call", async () => {
    expect(
      await startCheckout({ ...customerInput, productId: "x" }, deps)
    ).toEqual({ ok: false, code: "INVALID_INPUT" })
    expect(sessionRpc).not.toHaveBeenCalled()
  })
})

const FOR_CONFIRM = {
  state: "open",
  reference: "BT-1111111111",
  amount_agorot: 47200,
  created_on: "2026-11-20",
}

function routeRpc(record: unknown = ok({ state: "paid", payment_id: "p" })) {
  serviceRpc.mockImplementation(async (name: string) => {
    if (name === "mark_checkout_notified") return ok({ ok: true })
    if (name === "checkout_for_confirm") return ok(FOR_CONFIRM)
    if (name === "record_online_payment") return record
    throw new Error(`unexpected ${name}`)
  })
}

const names = () => serviceRpc.mock.calls.map(([name]) => name)

describe("confirmCheckout", () => {
  it("notify: marks first, finds one matching document, records it verified", async () => {
    routeRpc()
    findCheckoutDocument.mockResolvedValue({
      kind: "one",
      document: {
        id: "doc-1",
        amountAgorot: 47200,
        currency: "ILS",
        paidAt: "2026-11-20T10:00:00.000Z",
      },
    })

    const result = await confirmCheckout(CHECKOUT, NOTIFY, "notify", deps)

    expect(result).toEqual({ ok: true, state: "paid", pending: false })
    expect(names()).toEqual([
      "mark_checkout_notified",
      "checkout_for_confirm",
      "record_online_payment",
    ])
    expect(findCheckoutDocument).toHaveBeenCalledWith(
      "BT-1111111111",
      "2026-11-20"
    )
    expect(serviceRpc.mock.calls[2][1]).toEqual({
      p_checkout_id: CHECKOUT,
      p_secret: NOTIFY,
      p_secret_kind: "notify",
      p_document_id: "doc-1",
      p_outcome: "verified",
      p_amount_agorot: 47200,
      p_paid_at: "2026-11-20T10:00:00.000Z",
    })
  })

  it("browser: no mark", async () => {
    routeRpc()
    findCheckoutDocument.mockResolvedValue({ kind: "none" })
    await confirmCheckout(CHECKOUT, BROWSER, "browser", deps)
    expect(names()).toEqual(["checkout_for_confirm"])
  })

  it("no document yet: pending, nothing recorded", async () => {
    routeRpc()
    findCheckoutDocument.mockResolvedValue({ kind: "none" })
    expect(await confirmCheckout(CHECKOUT, NOTIFY, "notify", deps)).toEqual({
      ok: true,
      state: "open",
      pending: true,
    })
    expect(names()).not.toContain("record_online_payment")
  })

  it.each([
    [{ amountAgorot: 47100, currency: "ILS" }],
    [{ amountAgorot: 47200, currency: "USD" }],
    [{ amountAgorot: null, currency: "ILS" }],
  ])("a different amount or currency is amount_mismatch: %j", async (doc) => {
    routeRpc(ok({ state: "issue", issue: "amount_mismatch" }))
    findCheckoutDocument.mockResolvedValue({
      kind: "one",
      document: { id: "doc-1", paidAt: "2026-11-20T10:00:00.000Z", ...doc },
    })
    const result = await confirmCheckout(CHECKOUT, NOTIFY, "notify", deps)
    expect(result).toEqual({ ok: true, state: "issue", pending: false })
    expect(serviceRpc.mock.calls[2][1]).toMatchObject({
      p_outcome: "amount_mismatch",
    })
  })

  it("more than one document is not_verified, without a document id", async () => {
    routeRpc(ok({ state: "issue", issue: "not_verified" }))
    findCheckoutDocument.mockResolvedValue({ kind: "many" })
    await confirmCheckout(CHECKOUT, NOTIFY, "notify", deps)
    expect(serviceRpc.mock.calls[2][1]).toMatchObject({
      p_document_id: null,
      p_outcome: "not_verified",
      p_amount_agorot: null,
    })
  })

  it("morning down: GROW_UNAVAILABLE after the mark", async () => {
    routeRpc()
    findCheckoutDocument.mockRejectedValue(
      new GrowUnavailableError("documents_search", null)
    )
    expect(await confirmCheckout(CHECKOUT, NOTIFY, "notify", deps)).toEqual({
      ok: false,
      code: "GROW_UNAVAILABLE",
    })
    expect(names()).toEqual(["mark_checkout_notified", "checkout_for_confirm"])
  })

  it("Grow not configured: GROW_UNAVAILABLE; the kill switch alone does not stop it", async () => {
    routeRpc()
    findCheckoutDocument.mockResolvedValue({ kind: "none" })
    expect(
      await confirmCheckout(CHECKOUT, NOTIFY, "notify", {
        ...deps,
        env: { ...ENV, GROW_CLIENT_ID: "" },
      })
    ).toEqual({ ok: false, code: "GROW_UNAVAILABLE" })

    const off = await confirmCheckout(CHECKOUT, NOTIFY, "notify", {
      ...deps,
      env: { ...ENV, ONLINE_PAYMENTS_ENABLED: "false" },
    })
    expect(off.ok).toBe(true)
  })

  it("a wrong secret stops at the mark", async () => {
    serviceRpc.mockResolvedValue(p0001("CHECKOUT_NOT_FOUND"))
    expect(await confirmCheckout(CHECKOUT, NOTIFY, "notify", deps)).toEqual({
      ok: false,
      code: "CHECKOUT_NOT_FOUND",
    })
    expect(names()).toEqual(["mark_checkout_notified"])
  })

  it("a malformed id or secret is CHECKOUT_NOT_FOUND without a call", async () => {
    expect(await confirmCheckout("x", NOTIFY, "notify", deps)).toEqual({
      ok: false,
      code: "CHECKOUT_NOT_FOUND",
    })
    expect(await confirmCheckout(CHECKOUT, "short", "notify", deps)).toEqual({
      ok: false,
      code: "CHECKOUT_NOT_FOUND",
    })
    expect(serviceRpc).not.toHaveBeenCalled()
  })

  it("a database failure of the record is SERVER_ERROR (503 upstream)", async () => {
    routeRpc({ data: null, error: { code: "57P01", message: "terminated" } })
    findCheckoutDocument.mockResolvedValue({
      kind: "one",
      document: {
        id: "doc-1",
        amountAgorot: 47200,
        currency: "ILS",
        paidAt: "2026-11-20T10:00:00.000Z",
      },
    })
    vi.spyOn(console, "error").mockImplementation(() => {})
    expect(await confirmCheckout(CHECKOUT, NOTIFY, "notify", deps)).toEqual({
      ok: false,
      code: "SERVER_ERROR",
    })
  })
})

describe("returnPathFor", () => {
  const base = {
    product_kind: "session" as const,
    event_id: EVENT,
    customer_known: false,
  }

  it("paid, new customer: the join link", () => {
    expect(
      returnPathFor({ ...base, state: "paid", join_token: "tok" }, false)
    ).toBe("/join/tok")
  })

  it("paid, known customer: bookings (pinned) or purchases", () => {
    expect(
      returnPathFor({ ...base, state: "paid", customer_known: true }, false)
    ).toBe("/me/bookings")
    expect(
      returnPathFor(
        {
          ...base,
          state: "paid",
          customer_known: true,
          product_kind: "days",
          event_id: null,
        },
        false
      )
    ).toBe("/me/purchases")
  })

  it("paid, no link possible: the issue notice", () => {
    expect(
      returnPathFor({ ...base, state: "paid", join_blocked: true }, false)
    ).toBe(`/sessions/${EVENT}?payment=issue`)
  })

  it("not at morning yet: pending", () => {
    expect(returnPathFor({ ...base, state: "open" }, true)).toBe("/pay/pending")
    expect(returnPathFor({ ...base, state: "expired" }, true)).toBe(
      "/pay/pending"
    )
  })

  it("issue, failed, expired: the session page or my purchases", () => {
    expect(returnPathFor({ ...base, state: "issue" }, false)).toBe(
      `/sessions/${EVENT}?payment=issue`
    )
    expect(
      returnPathFor({ ...base, state: "failed", event_id: null }, false)
    ).toBe("/me/purchases?payment=failed")
    expect(closedPathFor("expired", EVENT)).toBe(
      `/sessions/${EVENT}?payment=expired`
    )
  })
})

describe("parseCheckoutCookie", () => {
  it("id and secret", () => {
    expect(parseCheckoutCookie(`${CHECKOUT}.${BROWSER}`)).toEqual({
      id: CHECKOUT,
      secret: BROWSER,
    })
  })

  it.each([
    null,
    "",
    CHECKOUT,
    `${CHECKOUT}.`,
    `x.${BROWSER}`,
    `${CHECKOUT}.a b`,
  ])("null for %j", (value) => {
    expect(parseCheckoutCookie(value)).toBeNull()
  })
})
