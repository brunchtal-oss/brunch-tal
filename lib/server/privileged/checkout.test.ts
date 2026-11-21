import { beforeEach, describe, expect, it, vi } from "vitest"

import {
  checkoutBannerId,
  checkoutCookieOptions,
  closedPathFor,
  paymentRedirectResponse,
  confirmCheckout,
  failFromPayment,
  purchaseOptions,
  returnFromPayment,
  returnPathFor,
  startCheckout,
  startPurchase,
  type CheckoutDeps,
} from "./checkout"
import { GrowUnavailableError, type GrowClient } from "./grow"

const serviceRpc = vi.fn()
// The profile read of a customer's Grow client (from().select().eq().maybeSingle()).
const profileRead = vi.fn()
const serviceFrom = vi.fn(() => ({
  select: () => ({ eq: () => ({ maybeSingle: profileRead }) }),
}))
const getClaims = vi.fn()
const cookieSet = vi.fn()
const cookieGet = vi.fn()
const hitRateLimit = vi.fn()
const peekRateLimit = vi.fn()

vi.mock("@/lib/server/privileged/service-client", () => ({
  createServiceClient: () => ({ rpc: serviceRpc, from: serviceFrom }),
}))
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getClaims } }),
}))
vi.mock("next/headers", () => ({
  cookies: async () => ({ set: cookieSet, get: cookieGet }),
}))
vi.mock("@/lib/server/privileged/rate-limit", () => ({
  clientIp: async () => "203.0.113.7",
  hitRateLimit: (...args: unknown[]) => hitRateLimit(...args),
  peekRateLimit: (...args: unknown[]) => peekRateLimit(...args),
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
  NEXT_PUBLIC_SITE_URL: "https://site.test",
}

const CHECKOUT = "11111111-1111-4111-8111-111111111111"
const OTHER = "55555555-5555-4555-8555-555555555555"
const PRODUCT = "22222222-2222-4222-8222-222222222222"
const EVENT = "33333333-3333-4333-8333-333333333333"
const KEY = "44444444-4444-4444-8444-444444444444"
// A guest's details: sent to Grow only.
const PAYER = { name: "Noa Guest", email: "noa.guest@example.test" }
const UID = "66666666-6666-4666-8666-666666666666"
const NOTIFY = "n".repeat(43)
const BROWSER = "b".repeat(43)
const BROWSER_2 = "c".repeat(43)

const createPaymentForm = vi.fn()
const findCheckoutDocument = vi.fn()
// The browser return's waits between looks, without waiting.
const sleep = vi.fn(async () => {})
const deps: CheckoutDeps = {
  env: ENV,
  sleep,
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
  peekRateLimit.mockResolvedValue("allowed")
  getClaims.mockResolvedValue({ data: { claims: { sub: UID } } })
  profileRead.mockResolvedValue({
    data: { full_name: "Dana Levi" },
    error: null,
  })
  cookieGet.mockReturnValue(undefined)
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
    expect(serviceRpc).not.toHaveBeenCalled()
  })

  it("no NEXT_PUBLIC_SITE_URL: ONLINE_PAYMENTS_OFF", async () => {
    const result = await startCheckout(customerInput, {
      ...deps,
      env: { ...ENV, NEXT_PUBLIC_SITE_URL: "" },
    })
    expect(result).toEqual({ ok: false, code: "ONLINE_PAYMENTS_OFF" })
    expect(serviceRpc).not.toHaveBeenCalled()
  })

  it("a customer: begin_checkout through the service role with the claims uid, the form, the cookie", async () => {
    serviceRpc.mockResolvedValue(ok(BEGUN))
    createPaymentForm.mockResolvedValue("https://pay.test/form")
    cookieGet.mockReturnValue({ value: `${OTHER}.${BROWSER_2}` })

    const result = await startCheckout(customerInput, deps)

    expect(result).toEqual({
      ok: true,
      data: { kind: "redirect", url: "https://pay.test/form" },
    })
    expect(serviceRpc).toHaveBeenCalledWith("begin_checkout", {
      p_auth_uid: UID,
      p_product_id: PRODUCT,
      p_event_id: null,
      p_terms_accepted: true,
      p_idempotency_key: KEY,
    })
    // The checkout bucket: her IP and her uid (3 an hour), checked
    // before and counted after the form exists.
    expect(peekRateLimit).toHaveBeenCalledWith("checkout", {
      ip: "203.0.113.7",
      id: UID,
    })
    expect(hitRateLimit).toHaveBeenCalledWith("checkout", {
      ip: "203.0.113.7",
      id: UID,
    })
    expect(hitRateLimit.mock.invocationCallOrder[0]).toBeGreaterThan(
      createPaymentForm.mock.invocationCallOrder[0]
    )
    // The form exists: reconciliation may look at it.
    expect(serviceRpc).toHaveBeenCalledWith("mark_checkout_form_created", {
      p_checkout_id: CHECKOUT,
      p_browser_secret: BROWSER,
    })
    const form = createPaymentForm.mock.calls[0][0]
    expect(form).toMatchObject({
      description: "BT-1111111111 · כרטיסייה",
      amountAgorot: 47200,
      successUrl: `https://site.test/pay/return?c=${CHECKOUT}`,
      failureUrl: `https://site.test/pay/failed?c=${CHECKOUT}`,
      custom: CHECKOUT,
    })
    const notify = new URL(form.notifyUrl)
    expect(notify.origin + notify.pathname).toBe(
      "https://site.test/api/payments/grow"
    )
    expect(notify.searchParams.get("c")).toBe(CHECKOUT)
    expect(notify.searchParams.get("s")).toBe(NOTIFY)
    // The new entry first, the earlier one kept.
    expect(cookieSet).toHaveBeenCalledWith(
      "bt_checkout",
      `${CHECKOUT}.${BROWSER},${OTHER}.${BROWSER_2}`,
      expect.objectContaining({
        httpOnly: true,
        secure: true,
        sameSite: "lax",
        maxAge: 60 * 60 * 24 * 7,
      })
    )
  })

  it("a customer without verified claims: NOT_AUTHORIZED, no row", async () => {
    getClaims.mockResolvedValue({ data: null })
    expect(await startCheckout(customerInput, deps)).toEqual({
      ok: false,
      code: "NOT_AUTHORIZED",
    })
    expect(serviceRpc).not.toHaveBeenCalled()
  })

  it("a guest: the checkout rate limit by IP, then the service role", async () => {
    serviceRpc.mockResolvedValue(ok({ ...BEGUN, event_id: EVENT }))
    createPaymentForm.mockResolvedValue("https://pay.test/form")

    const result = await startCheckout(
      { ...customerInput, as: "guest", eventId: EVENT, payer: PAYER },
      deps
    )

    expect(result.ok).toBe(true)
    // A guest: the IP key only (10 an hour).
    expect(peekRateLimit).toHaveBeenCalledWith("checkout", {
      ip: "203.0.113.7",
      id: null,
    })
    expect(hitRateLimit).toHaveBeenCalledWith("checkout", {
      ip: "203.0.113.7",
      id: null,
    })
    expect(serviceRpc).toHaveBeenCalledWith(
      "begin_guest_checkout",
      expect.objectContaining({ p_event_id: EVENT })
    )
    expect(getClaims).not.toHaveBeenCalled()
  })

  it("a guest over the limit: CHECKOUT_TOO_MANY, no row", async () => {
    peekRateLimit.mockResolvedValue("blocked")
    const result = await startCheckout(
      { ...customerInput, as: "guest", payer: PAYER },
      deps
    )
    expect(result).toEqual({ ok: false, code: "CHECKOUT_TOO_MANY" })
    expect(serviceRpc).not.toHaveBeenCalled()
  })

  it("a customer over her limit: CHECKOUT_TOO_MANY, no row, nothing counted", async () => {
    peekRateLimit.mockResolvedValue("blocked")
    expect(await startCheckout(customerInput, deps)).toEqual({
      ok: false,
      code: "CHECKOUT_TOO_MANY",
    })
    expect(serviceRpc).not.toHaveBeenCalled()
    expect(hitRateLimit).not.toHaveBeenCalled()
  })

  it("a failed attempt is not counted: a business code of the begin", async () => {
    serviceRpc.mockResolvedValue(p0001("EVENT_FULL"))
    await startCheckout(customerInput, deps)
    expect(hitRateLimit).not.toHaveBeenCalled()
  })

  it("a failed form mark fails the begin: cancelled, GROW_UNAVAILABLE, no cookie, not counted", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {})
    serviceRpc.mockImplementation(async (name: string) => {
      if (name === "begin_checkout") return ok(BEGUN)
      if (name === "mark_checkout_form_created") return p0001("SERVER_ERROR")
      return ok({ state: "failed" })
    })
    createPaymentForm.mockResolvedValue("https://pay.test/form")
    expect(await startCheckout(customerInput, deps)).toEqual({
      ok: false,
      code: "GROW_UNAVAILABLE",
    })
    expect(errors).toHaveBeenCalledWith("checkout.form_mark_failed", {
      code: "SERVER_ERROR",
    })
    expect(serviceRpc).toHaveBeenCalledWith("cancel_checkout", {
      p_checkout_id: CHECKOUT,
      p_browser_secret: BROWSER,
    })
    expect(cookieSet).not.toHaveBeenCalled()
    expect(hitRateLimit).not.toHaveBeenCalled()
    errors.mockRestore()
  })

  it("a business code of the RPC comes back as is", async () => {
    serviceRpc.mockResolvedValue(p0001("EVENT_FULL"))
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
    serviceRpc.mockResolvedValue(ok({ ...stored, reissue_required: true }))
    expect(await startCheckout(customerInput, deps)).toEqual({
      ok: true,
      data: { kind: "replayed" },
    })
    expect(createPaymentForm).not.toHaveBeenCalled()
    expect(cookieSet).not.toHaveBeenCalled()
  })

  it("Grow fails: cancel_checkout releases the hold, GROW_UNAVAILABLE", async () => {
    serviceRpc.mockImplementation(async (name: string) =>
      name === "begin_checkout" ? ok(BEGUN) : ok({ state: "failed" })
    )
    createPaymentForm.mockRejectedValue(
      new GrowUnavailableError("payment_form", 503)
    )

    expect(await startCheckout(customerInput, deps)).toEqual({
      ok: false,
      code: "GROW_UNAVAILABLE",
    })
    expect(serviceRpc).toHaveBeenCalledWith("cancel_checkout", {
      p_checkout_id: CHECKOUT,
      p_browser_secret: BROWSER,
    })
    expect(cookieSet).not.toHaveBeenCalled()
    expect(hitRateLimit).not.toHaveBeenCalled()
  })

  it("a failed cancel after a Grow failure is logged with the code only", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {})
    serviceRpc.mockImplementation(async (name: string) =>
      name === "begin_checkout" ? ok(BEGUN) : p0001("CHECKOUT_NOT_FOUND")
    )
    createPaymentForm.mockRejectedValue(
      new GrowUnavailableError("payment_form", 503)
    )
    await startCheckout(customerInput, deps)
    expect(errors).toHaveBeenCalledWith("checkout.cancel_failed", {
      code: "CHECKOUT_NOT_FOUND",
    })
    expect(JSON.stringify(errors.mock.calls)).not.toContain(BROWSER)
    errors.mockRestore()
  })

  it("a malformed id is INVALID_INPUT before any call", async () => {
    expect(
      await startCheckout({ ...customerInput, productId: "x" }, deps)
    ).toEqual({ ok: false, code: "INVALID_INPUT" })
    expect(serviceRpc).not.toHaveBeenCalled()
  })
})

const FOR_CONFIRM = {
  state: "open",
  reference: "BT-1111111111",
  amount_agorot: 47200,
  created_on: "2026-11-20",
}

function routeRpc(
  record: unknown = ok({ state: "paid", payment_id: "p" }),
  options: {
    retryAllowed?: boolean
    forConfirm?: unknown
    back?: unknown
  } = {}
) {
  serviceRpc.mockImplementation(async (name: string) => {
    if (name === "mark_checkout_notified") {
      return ok({ ok: true, retry_allowed: options.retryAllowed ?? true })
    }
    if (name === "checkout_for_confirm") {
      return options.forConfirm ?? ok(FOR_CONFIRM)
    }
    if (name === "record_online_payment") return record
    if (name === "checkout_return") return options.back
    throw new Error(`unexpected ${name}`)
  })
}

const names = () => serviceRpc.mock.calls.map(([name]) => name)

const ONE_DOC = {
  kind: "one",
  document: {
    id: "doc-1",
    amountAgorot: 47200,
    currency: "ILS",
    paidAt: "2026-11-20T10:00:00.000Z",
  },
}

describe("confirmCheckout", () => {
  it("notify: marks first, finds one matching document, records it verified", async () => {
    routeRpc()
    findCheckoutDocument.mockResolvedValue(ONE_DOC)

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

  it("system (reconciliation): no secret, no mark, kind 'system'", async () => {
    routeRpc()
    findCheckoutDocument.mockResolvedValue(ONE_DOC)
    expect(await confirmCheckout(CHECKOUT, null, "system", deps)).toEqual({
      ok: true,
      state: "paid",
      pending: false,
    })
    expect(names()).toEqual(["checkout_for_confirm", "record_online_payment"])
    expect(serviceRpc.mock.calls[0][1]).toEqual({
      p_checkout_id: CHECKOUT,
      p_secret: null,
      p_secret_kind: "system",
    })
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

  it("past the retry window (or not open): not pending, and morning down is not a 503", async () => {
    routeRpc(undefined, { retryAllowed: false })
    findCheckoutDocument.mockResolvedValue({ kind: "none" })
    expect(await confirmCheckout(CHECKOUT, NOTIFY, "notify", deps)).toEqual({
      ok: true,
      state: "open",
      pending: false,
    })
    findCheckoutDocument.mockRejectedValue(
      new GrowUnavailableError("documents_search", null)
    )
    expect(await confirmCheckout(CHECKOUT, NOTIFY, "notify", deps)).toEqual({
      ok: true,
      state: "open",
      pending: false,
    })
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

  it("morning down within the window: GROW_UNAVAILABLE after the mark", async () => {
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
    expect(await confirmCheckout(CHECKOUT, null, "browser", deps)).toEqual({
      ok: false,
      code: "CHECKOUT_NOT_FOUND",
    })
    expect(serviceRpc).not.toHaveBeenCalled()
  })

  it("a database failure of the record is SERVER_ERROR (503 upstream)", async () => {
    routeRpc({ data: null, error: { code: "57P01", message: "terminated" } })
    findCheckoutDocument.mockResolvedValue(ONE_DOC)
    const errors = vi.spyOn(console, "error").mockImplementation(() => {})
    expect(await confirmCheckout(CHECKOUT, NOTIFY, "notify", deps)).toEqual({
      ok: false,
      code: "SERVER_ERROR",
    })
    errors.mockRestore()
  })
})

describe("returnPathFor", () => {
  const base = {
    product_kind: "session" as const,
    event_id: EVENT,
    customer_known: false,
  }
  const path = (row: Parameters<typeof returnPathFor>[0], pending = false) =>
    returnPathFor(row, pending, CHECKOUT)

  it("paid, new customer: the join link (final)", () => {
    expect(path({ ...base, state: "paid", join_token: "tok" })).toEqual({
      path: "/join/tok",
      final: true,
    })
  })

  it("paid, known customer: the success notice in bookings (pinned) or purchases", () => {
    expect(
      path({ ...base, state: "paid", customer_known: true, booked: true })
    ).toEqual({ path: "/me/bookings?payment=paid", final: true })
    expect(
      path({
        ...base,
        state: "paid",
        customer_known: true,
        product_kind: "days",
        event_id: null,
      })
    ).toEqual({ path: "/me/purchases?payment=paid", final: true })
  })

  it("paid and parked (no booking), known customer: no_place", () => {
    expect(
      path({ ...base, state: "paid", customer_known: true, booked: false })
    ).toEqual({ path: "/me/bookings?payment=no_place", final: true })
  })

  it("paid, no link possible: the issue notice", () => {
    expect(path({ ...base, state: "paid", join_blocked: true })).toEqual({
      path: `/sessions/${EVENT}?payment=issue`,
      final: true,
    })
  })

  it("not at morning yet: pending with ?c=, not final", () => {
    expect(path({ ...base, state: "open" }, true)).toEqual({
      path: `/pay/pending?c=${CHECKOUT}`,
      final: false,
    })
    expect(path({ ...base, state: "expired" }, true).final).toBe(false)
  })

  it("issue: the session page, my purchases, or home for a guest; without money received the neutral review", () => {
    expect(path({ ...base, state: "issue" })).toEqual({
      path: `/sessions/${EVENT}?payment=issue`,
      final: true,
    })
    expect(
      path({ ...base, state: "issue", event_id: null, customer_known: true })
        .path
    ).toBe("/me/purchases?payment=issue")
    expect(path({ ...base, state: "issue", has_payment: false })).toEqual({
      path: `/sessions/${EVENT}?payment=review`,
      final: true,
    })
    expect(path({ ...base, state: "issue", event_id: null }).path).toBe(
      "/?payment=issue"
    )
    expect(closedPathFor("expired", EVENT, false)).toBe(
      `/sessions/${EVENT}?payment=expired`
    )
  })

  it("the success URL never says failed: unpaid states are pending, then not_found after the end", () => {
    for (const state of ["open", "failed", "expired"] as const) {
      expect(path({ ...base, state }), state).toEqual({
        path: `/pay/pending?c=${CHECKOUT}`,
        final: false,
      })
      expect(path({ ...base, state, pending_over: true }), state).toEqual({
        path: `/sessions/${EVENT}?payment=not_found`,
        final: true,
      })
    }
  })
})

describe("the checkout cookie's options", () => {
  it("secure only on https", () => {
    expect(checkoutCookieOptions(ENV).secure).toBe(true)
    expect(
      checkoutCookieOptions({
        ...ENV,
        NEXT_PUBLIC_SITE_URL: "http://192.168.1.5:3000",
      }).secure
    ).toBe(false)
  })
})

const RETURN_ROW = {
  state: "paid",
  product_kind: "session",
  event_id: EVENT,
  customer_known: false,
}

describe("returnFromPayment", () => {
  const cookie = `${CHECKOUT}.${BROWSER},${OTHER}.${BROWSER_2}`

  it.each([
    ["no cookie", undefined, CHECKOUT],
    ["a bad cookie", "garbage", CHECKOUT],
    ["no c", cookie, null],
    ["c does not match", cookie, EVENT],
  ])("%s: not found, no call", async (_label, value, c) => {
    expect(await returnFromPayment(value, c, deps)).toEqual({
      path: "/sessions",
    })
    expect(serviceRpc).not.toHaveBeenCalled()
  })

  it("paid, new customer: the join link, and that entry leaves the cookie", async () => {
    routeRpc(undefined, {
      back: ok({ ...RETURN_ROW, joined: false, join_token: "tok" }),
    })
    findCheckoutDocument.mockResolvedValue(ONE_DOC)
    expect(await returnFromPayment(cookie, CHECKOUT, deps)).toEqual({
      path: "/join/tok",
      cookie: `${OTHER}.${BROWSER_2}`,
    })
  })

  it("the last entry with a join token: the cookie is deleted", async () => {
    routeRpc(undefined, {
      back: ok({ ...RETURN_ROW, join_token: "tok" }),
    })
    findCheckoutDocument.mockResolvedValue(ONE_DOC)
    expect(
      await returnFromPayment(`${CHECKOUT}.${BROWSER}`, CHECKOUT, deps)
    ).toEqual({ path: "/join/tok", cookie: null })
  })

  it("morning down on a paid checkout: still her area (booked), the entry leaves", async () => {
    routeRpc(undefined, {
      forConfirm: ok({ ...FOR_CONFIRM, state: "paid" }),
      back: ok({ ...RETURN_ROW, customer_known: true, booked: true }),
    })
    findCheckoutDocument.mockRejectedValue(
      new GrowUnavailableError("documents_search", null)
    )
    expect(await returnFromPayment(cookie, CHECKOUT, deps)).toEqual({
      path: "/me/bookings?payment=paid",
      cookie: `${OTHER}.${BROWSER_2}`,
      outcome: { payment: "paid", kind: "session" },
    })
  })

  it("paid, known customer: a missing booked reads as booked; false is no_place", async () => {
    routeRpc(undefined, {
      back: ok({ ...RETURN_ROW, customer_known: true }),
    })
    findCheckoutDocument.mockResolvedValue(ONE_DOC)
    expect((await returnFromPayment(cookie, CHECKOUT, deps)).path).toBe(
      "/me/bookings?payment=paid"
    )
    routeRpc(undefined, {
      back: ok({ ...RETURN_ROW, customer_known: true, booked: false }),
    })
    expect(await returnFromPayment(cookie, CHECKOUT, deps)).toEqual({
      path: "/me/bookings?payment=no_place",
      cookie: `${OTHER}.${BROWSER_2}`,
      outcome: { payment: "no_place", kind: "session" },
    })
  })

  it("paid card, known customer: the purchases notice with a card outcome", async () => {
    routeRpc(undefined, {
      back: ok({
        ...RETURN_ROW,
        product_kind: "days",
        event_id: null,
        customer_known: true,
      }),
    })
    findCheckoutDocument.mockResolvedValue(ONE_DOC)
    expect(await returnFromPayment(cookie, CHECKOUT, deps)).toMatchObject({
      path: "/me/purchases?payment=paid",
      outcome: { payment: "paid", kind: "card" },
    })
  })

  it.each(["failed", "expired"])(
    "success URL, %s, no document yet: pending, the entry kept (never 'לא חויבת')",
    async (state) => {
      routeRpc(undefined, {
        forConfirm: ok({ ...FOR_CONFIRM, state }),
        back: ok({ ...RETURN_ROW, state }),
      })
      findCheckoutDocument.mockResolvedValue({ kind: "none" })
      expect(await returnFromPayment(cookie, CHECKOUT, deps)).toEqual({
        path: `/pay/pending?c=${CHECKOUT}`,
      })
    }
  )

  it.each(["open", "failed", "expired"])(
    "success URL, %s, 30 minutes past the pay window and grace: not_found, the entry removed",
    async (state) => {
      routeRpc(undefined, {
        forConfirm: ok({ ...FOR_CONFIRM, state }),
        back: ok({ ...RETURN_ROW, state, pending_over: true }),
      })
      findCheckoutDocument.mockResolvedValue({ kind: "none" })
      expect(await returnFromPayment(cookie, CHECKOUT, deps)).toEqual({
        path: `/sessions/${EVENT}?payment=not_found`,
        cookie: `${OTHER}.${BROWSER_2}`,
        outcome: { payment: "not_found", kind: "session" },
      })
    }
  )

  it("issue: final; with money received the issue notice, without it the neutral review", async () => {
    routeRpc(undefined, {
      forConfirm: ok({ ...FOR_CONFIRM, state: "issue" }),
      back: ok({ ...RETURN_ROW, state: "issue", has_payment: true }),
    })
    findCheckoutDocument.mockResolvedValue({ kind: "none" })
    expect(await returnFromPayment(cookie, CHECKOUT, deps)).toEqual({
      path: `/sessions/${EVENT}?payment=issue`,
      cookie: `${OTHER}.${BROWSER_2}`,
      outcome: { payment: "issue", kind: "session" },
    })
    routeRpc(undefined, {
      forConfirm: ok({ ...FOR_CONFIRM, state: "issue" }),
      back: ok({ ...RETURN_ROW, state: "issue", has_payment: false }),
    })
    expect(await returnFromPayment(cookie, CHECKOUT, deps)).toMatchObject({
      path: `/sessions/${EVENT}?payment=review`,
      outcome: { payment: "review", kind: "session" },
    })
  })

  it("a known customer past the end: her area's session page", async () => {
    routeRpc(undefined, {
      forConfirm: ok({ ...FOR_CONFIRM, state: "failed" }),
      back: ok({
        ...RETURN_ROW,
        state: "failed",
        customer_known: true,
        pending_over: true,
      }),
    })
    findCheckoutDocument.mockResolvedValue({ kind: "none" })
    expect((await returnFromPayment(cookie, CHECKOUT, deps)).path).toBe(
      `/me/sessions/${EVENT}?payment=not_found`
    )
  })

  it("a known customer's card issue: my purchases, never the home page", async () => {
    routeRpc(undefined, {
      forConfirm: ok({ ...FOR_CONFIRM, state: "issue" }),
      back: ok({
        ...RETURN_ROW,
        state: "issue",
        product_kind: "days",
        event_id: null,
        customer_known: true,
      }),
    })
    findCheckoutDocument.mockResolvedValue({ kind: "none" })
    expect(await returnFromPayment(cookie, CHECKOUT, deps)).toMatchObject({
      path: "/me/purchases?payment=issue",
      outcome: { payment: "issue", kind: "card" },
    })
  })

  it("a checkout that no longer exists: not found, its entry leaves", async () => {
    serviceRpc.mockResolvedValue(p0001("CHECKOUT_NOT_FOUND"))
    expect(await returnFromPayment(cookie, CHECKOUT, deps)).toEqual({
      path: "/sessions",
      cookie: `${OTHER}.${BROWSER_2}`,
    })
  })

  it("the receipt lands a moment after the return: looked at again, the join link without the pending page", async () => {
    routeRpc(undefined, {
      back: ok({ ...RETURN_ROW, joined: false, join_token: "tok" }),
    })
    findCheckoutDocument
      .mockResolvedValueOnce({ kind: "none" })
      .mockResolvedValueOnce(ONE_DOC)
    expect((await returnFromPayment(cookie, CHECKOUT, deps)).path).toBe(
      "/join/tok"
    )
    expect(findCheckoutDocument).toHaveBeenCalledTimes(2)
    expect(sleep).toHaveBeenCalledTimes(1)
    expect(sleep).toHaveBeenCalledWith(1000)
  })

  it("still no receipt after the looks (about 10 seconds): the pending page", async () => {
    routeRpc(undefined, { back: ok({ ...RETURN_ROW, state: "open" }) })
    findCheckoutDocument.mockResolvedValue({ kind: "none" })
    expect(await returnFromPayment(cookie, CHECKOUT, deps)).toEqual({
      path: `/pay/pending?c=${CHECKOUT}`,
    })
    expect(findCheckoutDocument).toHaveBeenCalledTimes(5)
    expect(sleep.mock.calls).toEqual([[1000], [2000], [3000], [4000]])
  })

  it("a paid checkout or morning down: no further look", async () => {
    routeRpc(undefined, {
      forConfirm: ok({ ...FOR_CONFIRM, state: "paid" }),
      back: ok({ ...RETURN_ROW, customer_known: true, booked: true }),
    })
    findCheckoutDocument.mockRejectedValue(
      new GrowUnavailableError("documents_search", null)
    )
    await returnFromPayment(cookie, CHECKOUT, deps)
    expect(findCheckoutDocument).toHaveBeenCalledTimes(1)
    expect(sleep).not.toHaveBeenCalled()
  })

  it("morning down on an open checkout: pending", async () => {
    routeRpc(undefined, {
      back: ok({ ...RETURN_ROW, state: "open" }),
    })
    findCheckoutDocument.mockRejectedValue(
      new GrowUnavailableError("documents_search", null)
    )
    expect(await returnFromPayment(cookie, CHECKOUT, deps)).toEqual({
      path: `/pay/pending?c=${CHECKOUT}`,
    })
  })
})

describe("failFromPayment", () => {
  const cookie = `${OTHER}.${BROWSER_2},${CHECKOUT}.${BROWSER}`

  it("cancels only the entry of c; the failed outcome for the notice", async () => {
    serviceRpc.mockResolvedValue(
      ok({
        state: "failed",
        product_kind: "session",
        event_id: EVENT,
        customer_known: false,
      })
    )
    expect(await failFromPayment(cookie, CHECKOUT)).toEqual({
      path: `/sessions/${EVENT}?payment=failed`,
      cookie: `${OTHER}.${BROWSER_2}`,
      outcome: { payment: "failed", kind: "session" },
    })
    expect(serviceRpc).toHaveBeenCalledWith("cancel_checkout", {
      p_checkout_id: CHECKOUT,
      p_browser_secret: BROWSER,
    })
  })

  it.each([
    ["no cookie", undefined, CHECKOUT],
    ["no c", cookie, null],
    ["c does not match", cookie, EVENT],
  ])("%s: not found, nothing cancelled", async (_label, value, c) => {
    expect(await failFromPayment(value, c)).toEqual({ path: "/sessions" })
    expect(serviceRpc).not.toHaveBeenCalled()
  })

  it("paid on the failure URL: /pay/return for that checkout", async () => {
    serviceRpc.mockResolvedValue(
      ok({ state: "paid", event_id: null, customer_known: false })
    )
    expect(await failFromPayment(cookie, CHECKOUT)).toEqual({
      path: `/pay/return?c=${CHECKOUT}`,
    })
  })

  it("a guest's non-pinned failure: the home page, never /me", async () => {
    serviceRpc.mockResolvedValue(
      ok({
        state: "failed",
        product_kind: "days",
        event_id: null,
        customer_known: false,
      })
    )
    expect(await failFromPayment(cookie, CHECKOUT)).toEqual({
      path: "/?payment=failed",
      cookie: `${OTHER}.${BROWSER_2}`,
      outcome: { payment: "failed", kind: "card" },
    })
  })

  it("the failure URL still says failed; an issue there gets the neutral review", async () => {
    serviceRpc.mockResolvedValue(
      ok({
        state: "issue",
        product_kind: "session",
        event_id: EVENT,
        customer_known: false,
      })
    )
    expect(await failFromPayment(cookie, CHECKOUT)).toMatchObject({
      path: `/sessions/${EVENT}?payment=review`,
      outcome: { payment: "review", kind: "session" },
    })
  })

  it("a database error: pending for that checkout, the entry stays", async () => {
    serviceRpc.mockResolvedValue({
      data: null,
      error: { code: "57P01", message: "terminated" },
    })
    expect(await failFromPayment(cookie, CHECKOUT)).toEqual({
      path: `/pay/pending?c=${CHECKOUT}`,
    })
  })

  it("the only entry fails: the cookie is deleted", async () => {
    serviceRpc.mockResolvedValue(
      ok({ state: "failed", event_id: EVENT, customer_known: false })
    )
    expect(await failFromPayment(`${CHECKOUT}.${BROWSER}`, CHECKOUT)).toEqual({
      path: `/sessions/${EVENT}?payment=failed`,
      cookie: null,
      outcome: { payment: "failed", kind: "card" },
    })
  })
})

const OPTIONS = {
  enabled: true,
  public_purchase: false,
  products: [
    {
      id: PRODUCT,
      name: "כרטיסייה",
      type: "card",
      price_agorot: 47200,
      units: 4,
      validity_mode: "days",
      validity_days: 49,
    },
  ],
}

describe("purchaseOptions (PR B)", () => {
  it("the kill switch off: nothing, and no call", async () => {
    expect(
      await purchaseOptions("customer", EVENT, {
        ...deps,
        env: { ...ENV, ONLINE_PAYMENTS_ENABLED: "false" },
      })
    ).toEqual({ enabled: false, products: [] })
    expect(serviceRpc).not.toHaveBeenCalled()
  })

  it("a customer: the uid of her verified claims, through the service role", async () => {
    serviceRpc.mockResolvedValue(ok(OPTIONS))
    const options = await purchaseOptions("customer", EVENT, deps)
    expect(options.enabled).toBe(true)
    expect(options.products.map((p) => p.id)).toEqual([PRODUCT])
    expect(serviceRpc).toHaveBeenCalledWith("get_purchase_options", {
      p_event_id: EVENT,
      p_auth_uid: UID,
    })
  })

  it("a guest: no uid, the claims are not read", async () => {
    serviceRpc.mockResolvedValue(ok(OPTIONS))
    await purchaseOptions("guest", EVENT, deps)
    expect(serviceRpc).toHaveBeenCalledWith("get_purchase_options", {
      p_event_id: EVENT,
      p_auth_uid: null,
    })
    expect(getClaims).not.toHaveBeenCalled()
  })

  it("a customer without claims, a bad event id or a read error: nothing", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {})
    getClaims.mockResolvedValue({ data: null })
    expect((await purchaseOptions("customer", EVENT, deps)).enabled).toBe(false)
    getClaims.mockResolvedValue({ data: { claims: { sub: UID } } })
    expect((await purchaseOptions("customer", "x", deps)).enabled).toBe(false)
    expect(serviceRpc).not.toHaveBeenCalled()
    serviceRpc.mockResolvedValue(p0001("SERVER_ERROR"))
    expect(await purchaseOptions("customer", null, deps)).toEqual({
      enabled: false,
      products: [],
    })
    expect(errors).toHaveBeenCalledWith("checkout.options_failed", {
      code: "SERVER_ERROR",
    })
    errors.mockRestore()
  })
})

describe("startPurchase (PR B)", () => {
  const input = {
    as: "customer" as const,
    productId: PRODUCT,
    eventId: null,
    termsAccepted: true,
    idempotencyKey: KEY,
  }

  it("an offered product: the checkout starts", async () => {
    serviceRpc.mockImplementation(async (name: string) =>
      name === "get_purchase_options" ? ok(OPTIONS) : ok(BEGUN)
    )
    createPaymentForm.mockResolvedValue("https://pay.test/form")
    expect(await startPurchase(input, deps)).toEqual({
      ok: true,
      data: { kind: "redirect", url: "https://pay.test/form" },
    })
    expect(names()[0]).toBe("get_purchase_options")
    expect(names()).toContain("begin_checkout")
  })

  it("terms not published (enabled false): ONLINE_PAYMENTS_OFF, no checkout", async () => {
    serviceRpc.mockResolvedValue(ok({ ...OPTIONS, enabled: false }))
    expect(await startPurchase(input, deps)).toEqual({
      ok: false,
      code: "ONLINE_PAYMENTS_OFF",
    })
    expect(names()).toEqual(["get_purchase_options"])
  })

  it("a product the sheet would not offer (e.g. a hidden intro): PRODUCT_NOT_PURCHASABLE", async () => {
    serviceRpc.mockResolvedValue(ok({ ...OPTIONS, products: [] }))
    expect(await startPurchase(input, deps)).toEqual({
      ok: false,
      code: "PRODUCT_NOT_PURCHASABLE",
    })
    expect(names()).toEqual(["get_purchase_options"])
  })

  it("terms not ticked: TERMS_REQUIRED before any call", async () => {
    expect(
      await startPurchase({ ...input, termsAccepted: false }, deps)
    ).toEqual({ ok: false, code: "TERMS_REQUIRED" })
    expect(serviceRpc).not.toHaveBeenCalled()
  })

  it("the kill switch off: ONLINE_PAYMENTS_OFF before any call", async () => {
    expect(
      await startPurchase(input, {
        ...deps,
        env: { ...ENV, ONLINE_PAYMENTS_ENABLED: "false" },
      })
    ).toEqual({ ok: false, code: "ONLINE_PAYMENTS_OFF" })
    expect(serviceRpc).not.toHaveBeenCalled()
  })
})

describe("startPurchase: review pass 1", () => {
  const input = {
    as: "customer" as const,
    productId: PRODUCT,
    eventId: EVENT,
    termsAccepted: true,
    idempotencyKey: KEY,
  }

  it("a card sent with a session starts without it", async () => {
    serviceRpc.mockImplementation(async (name: string) =>
      name === "get_purchase_options" ? ok(OPTIONS) : ok(BEGUN)
    )
    createPaymentForm.mockResolvedValue("https://pay.test/form")
    await startPurchase(input, deps)
    expect(serviceRpc).toHaveBeenCalledWith(
      "begin_checkout",
      expect.objectContaining({ p_event_id: null })
    )
  })

  it("the guest path refuses a signed-in caller: NOT_AUTHORIZED, no call", async () => {
    expect(await startPurchase({ ...input, as: "guest" }, deps)).toEqual({
      ok: false,
      code: "NOT_AUTHORIZED",
    })
    expect(serviceRpc).not.toHaveBeenCalled()
  })

  it("a real guest goes on", async () => {
    getClaims.mockResolvedValue({ data: null })
    serviceRpc.mockResolvedValue(ok({ ...OPTIONS, products: [] }))
    expect(await startPurchase({ ...input, as: "guest" }, deps)).toEqual({
      ok: false,
      code: "PRODUCT_NOT_PURCHASABLE",
    })
  })
})

// Grow refuses a form without a client name (errorCode 2201, sandbox
// 2026-11-21): a guest sends her name and email, a customer's come from her
// profile and claims. They go to Grow only.
describe("the payer sent to Grow", () => {
  const guest = {
    as: "guest" as const,
    productId: PRODUCT,
    eventId: EVENT,
    termsAccepted: true,
    idempotencyKey: KEY,
    payer: PAYER,
  }

  it("a customer: her profile's name and her claims' email", async () => {
    getClaims.mockResolvedValue({
      data: { claims: { sub: UID, email: "dana@example.test" } },
    })
    serviceRpc.mockResolvedValue(ok(BEGUN))
    createPaymentForm.mockResolvedValue("https://pay.test/form")
    await startCheckout(customerInput, deps)
    expect(serviceFrom).toHaveBeenCalledWith("profiles")
    expect(createPaymentForm.mock.calls[0][0].client).toEqual({
      name: "Dana Levi",
      emails: ["dana@example.test"],
    })
  })

  it("a customer's page cannot send other details: they are ignored", async () => {
    serviceRpc.mockImplementation(async (name: string) =>
      name === "get_purchase_options" ? ok(OPTIONS) : ok(BEGUN)
    )
    createPaymentForm.mockResolvedValue("https://pay.test/form")
    await startPurchase({ ...customerInput, payer: PAYER }, deps)
    expect(createPaymentForm.mock.calls[0][0].client).toEqual({
      name: "Dana Levi",
    })
  })

  it("a customer whose profile cannot be read: SERVER_ERROR, no row, no detail logged", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {})
    profileRead.mockResolvedValue({ data: null, error: { code: "XX000" } })
    expect(await startCheckout(customerInput, deps)).toEqual({
      ok: false,
      code: "SERVER_ERROR",
    })
    expect(serviceRpc).not.toHaveBeenCalled()
    expect(createPaymentForm).not.toHaveBeenCalled()
    expect(errors).toHaveBeenCalledWith("checkout.payer_failed", {
      found: false,
    })
    errors.mockRestore()
  })

  it("a guest: her name and email go to Grow as the client", async () => {
    serviceRpc.mockResolvedValue(ok({ ...BEGUN, event_id: EVENT }))
    createPaymentForm.mockResolvedValue("https://pay.test/form")
    await startCheckout(guest, deps)
    expect(createPaymentForm.mock.calls[0][0].client).toEqual({
      name: "Noa Guest",
      emails: ["noa.guest@example.test"],
    })
    expect(serviceFrom).not.toHaveBeenCalled()
  })

  it.each([
    ["no details", undefined],
    ["a blank name", { ...PAYER, name: "   " }],
    ["a name over 80", { ...PAYER, name: "x".repeat(81) }],
    ["a bad email", { ...PAYER, email: "noa@" }],
    ["an email over 254", { ...PAYER, email: `${"a".repeat(250)}@x.co` }],
  ])("a guest with %s: INVALID_INPUT before any call", async (_, payer) => {
    expect(await startCheckout({ ...guest, payer }, deps)).toEqual({
      ok: false,
      code: "INVALID_INPUT",
    })
    expect(serviceRpc).not.toHaveBeenCalled()
    expect(peekRateLimit).not.toHaveBeenCalled()
  })

  it("the details never reach a log, an RPC or a cookie, even when Grow fails", async () => {
    const spies = (["error", "warn", "log", "info"] as const).map((m) =>
      vi.spyOn(console, m).mockImplementation(() => {})
    )
    serviceRpc.mockImplementation(async (name: string) =>
      name === "begin_guest_checkout"
        ? ok({ ...BEGUN, event_id: EVENT })
        : ok({ state: "failed" })
    )
    createPaymentForm.mockRejectedValue(new Error("boom"))
    expect(await startCheckout(guest, deps)).toEqual({
      ok: false,
      code: "GROW_UNAVAILABLE",
    })
    // And once more with a form, so the cookie is written.
    createPaymentForm.mockResolvedValue("https://pay.test/form")
    serviceRpc.mockImplementation(async () => ok({ ...BEGUN, event_id: EVENT }))
    expect((await startCheckout(guest, deps)).ok).toBe(true)

    const seen = JSON.stringify([
      serviceRpc.mock.calls,
      cookieSet.mock.calls,
      hitRateLimit.mock.calls,
      peekRateLimit.mock.calls,
      ...spies.map((s) => s.mock.calls),
    ])
    for (const detail of ["Noa Guest", "noa.guest@example.test"]) {
      expect(seen).not.toContain(detail)
    }
    expect(cookieSet).toHaveBeenCalledTimes(1)
    for (const s of spies) s.mockRestore()
  })
})

describe("closedPathFor (review pass 1)", () => {
  it("a known customer stays in her area; a guest on the public site", () => {
    expect(closedPathFor("failed", EVENT, true)).toBe(
      `/me/sessions/${EVENT}?payment=failed`
    )
    expect(closedPathFor("issue", null, true)).toBe(
      "/me/purchases?payment=issue"
    )
    expect(closedPathFor("failed", EVENT, false)).toBe(
      `/sessions/${EVENT}?payment=failed`
    )
    expect(closedPathFor("failed", null, false)).toBe("/?payment=failed")
  })
})

describe("paymentRedirectResponse: the outcome cookie", () => {
  it("a ?payment= redirect sets the one-minute httpOnly outcome", () => {
    const response = paymentRedirectResponse(
      {
        path: `/sessions/${EVENT}?payment=failed`,
        cookie: null,
        outcome: { payment: "failed", kind: "session" },
      },
      "https://site.test/pay/failed",
      ENV
    )
    const header = response.headers.getSetCookie().join("\n")
    expect(header).toContain("bt_payment_outcome=failed.session")
    expect(header).toMatch(/bt_payment_outcome=[^\n]*Max-Age=60/)
    expect(header).toMatch(/bt_payment_outcome=[^\n]*HttpOnly/)
    expect(header).toMatch(/bt_payment_outcome=[^\n]*Path=\//)
  })

  it("no outcome: no outcome cookie (pending, a join link)", () => {
    const response = paymentRedirectResponse(
      { path: `/pay/pending?c=${CHECKOUT}` },
      "https://site.test/pay/return",
      ENV
    )
    expect(response.headers.getSetCookie().join("\n")).not.toContain(
      "bt_payment_outcome"
    )
  })
})

describe("checkoutBannerId (review pass 1)", () => {
  it("the newest entry the database says is paid and unjoined within 24 hours", async () => {
    cookieGet.mockReturnValue({
      value: `${OTHER}.${BROWSER_2},${CHECKOUT}.${BROWSER}`,
    })
    serviceRpc.mockImplementation(
      async (_name: string, args: { p_checkout_id: string }) =>
        ok({ show: args.p_checkout_id === CHECKOUT })
    )
    expect(await checkoutBannerId(deps)).toBe(CHECKOUT)
    expect(serviceRpc).toHaveBeenCalledWith("checkout_banner_state", {
      p_checkout_id: OTHER,
      p_browser_secret: BROWSER_2,
    })
  })

  it("no qualifying entry (open, failed, expired, joined, old): null", async () => {
    cookieGet.mockReturnValue({ value: `${CHECKOUT}.${BROWSER}` })
    serviceRpc.mockResolvedValue(ok({ show: false }))
    expect(await checkoutBannerId(deps)).toBeNull()
  })

  it("no cookie, or the kill switch off: null and no call", async () => {
    cookieGet.mockReturnValue(undefined)
    expect(await checkoutBannerId(deps)).toBeNull()
    cookieGet.mockReturnValue({ value: `${CHECKOUT}.${BROWSER}` })
    expect(
      await checkoutBannerId({
        ...deps,
        env: { ...ENV, ONLINE_PAYMENTS_ENABLED: "false" },
      })
    ).toBeNull()
    expect(serviceRpc).not.toHaveBeenCalled()
  })

  it("a read error: null, logged with its code", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {})
    cookieGet.mockReturnValue({ value: `${CHECKOUT}.${BROWSER}` })
    serviceRpc.mockResolvedValue(p0001("SERVER_ERROR"))
    expect(await checkoutBannerId(deps)).toBeNull()
    expect(errors).toHaveBeenCalledWith("checkout.banner_failed", {
      code: "SERVER_ERROR",
    })
    errors.mockRestore()
  })
})
