import { beforeEach, describe, expect, it, vi } from "vitest"

import {
  checkoutCookieOptions,
  checkoutEntryFor,
  closedPathFor,
  confirmCheckout,
  failFromPayment,
  parseCheckoutCookie,
  returnFromPayment,
  returnPathFor,
  serializeCheckoutCookie,
  startCheckout,
  type CheckoutDeps,
} from "./checkout"
import { GrowUnavailableError, type GrowClient } from "./grow"

const serviceRpc = vi.fn()
const getClaims = vi.fn()
const cookieSet = vi.fn()
const cookieGet = vi.fn()
const hitRateLimit = vi.fn()
const peekRateLimit = vi.fn()

vi.mock("@/lib/server/privileged/service-client", () => ({
  createServiceClient: () => ({ rpc: serviceRpc }),
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
const UID = "66666666-6666-4666-8666-666666666666"
const NOTIFY = "n".repeat(43)
const BROWSER = "b".repeat(43)
const BROWSER_2 = "c".repeat(43)

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
  peekRateLimit.mockResolvedValue("allowed")
  getClaims.mockResolvedValue({ data: { claims: { sub: UID } } })
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
      { ...customerInput, as: "guest", eventId: EVENT },
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
    const result = await startCheckout({ ...customerInput, as: "guest" }, deps)
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

  it("issue, failed, expired: the session page, my purchases, or home for a guest", () => {
    expect(returnPathFor({ ...base, state: "issue" }, false)).toBe(
      `/sessions/${EVENT}?payment=issue`
    )
    expect(
      returnPathFor(
        { ...base, state: "failed", event_id: null, customer_known: true },
        false
      )
    ).toBe("/me/purchases?payment=failed")
    expect(
      returnPathFor({ ...base, state: "failed", event_id: null }, false)
    ).toBe("/?payment=failed")
    expect(closedPathFor("expired", EVENT, false)).toBe(
      `/sessions/${EVENT}?payment=expired`
    )
  })
})

describe("the checkout cookie", () => {
  it("entries newest first, at most 5, invalid ones skipped", () => {
    const entries = Array.from({ length: 6 }, (_, i) => ({
      id: `${i}1111111-1111-4111-8111-111111111111`,
      secret: BROWSER,
    }))
    const value = serializeCheckoutCookie(entries)
    expect(value.split(",")).toHaveLength(5)
    expect(parseCheckoutCookie(`x.y,${value}`)).toEqual(entries.slice(0, 5))
  })

  it.each([
    null,
    "",
    CHECKOUT,
    `${CHECKOUT}.`,
    `x.${BROWSER}`,
    `${CHECKOUT}.a b`,
  ])("no entry in %j", (value) => {
    expect(parseCheckoutCookie(value)).toEqual([])
  })

  it("the entry of c only", () => {
    const cookie = `${OTHER}.${BROWSER_2},${CHECKOUT}.${BROWSER}`
    expect(checkoutEntryFor(cookie, CHECKOUT)).toEqual({
      id: CHECKOUT,
      secret: BROWSER,
    })
    expect(checkoutEntryFor(cookie, null)).toBeNull()
    expect(checkoutEntryFor(cookie, EVENT)).toBeNull()
  })

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

  it("morning down on a paid checkout: still her join link (or her area)", async () => {
    routeRpc(undefined, {
      forConfirm: ok({ ...FOR_CONFIRM, state: "paid" }),
      back: ok({ ...RETURN_ROW, customer_known: true }),
    })
    findCheckoutDocument.mockRejectedValue(
      new GrowUnavailableError("documents_search", null)
    )
    expect(await returnFromPayment(cookie, CHECKOUT, deps)).toEqual({
      path: "/me/bookings",
    })
  })

  it("morning down on an open checkout: pending", async () => {
    routeRpc(undefined, {
      back: ok({ ...RETURN_ROW, state: "open" }),
    })
    findCheckoutDocument.mockRejectedValue(
      new GrowUnavailableError("documents_search", null)
    )
    expect(await returnFromPayment(cookie, CHECKOUT, deps)).toEqual({
      path: "/pay/pending",
    })
  })
})

describe("failFromPayment", () => {
  const cookie = `${OTHER}.${BROWSER_2},${CHECKOUT}.${BROWSER}`

  it("cancels only the entry of c", async () => {
    serviceRpc.mockResolvedValue(
      ok({ state: "failed", event_id: EVENT, customer_known: false })
    )
    expect(await failFromPayment(cookie, CHECKOUT)).toEqual({
      path: `/sessions/${EVENT}?payment=failed`,
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
      ok({ state: "failed", event_id: null, customer_known: false })
    )
    expect(await failFromPayment(cookie, CHECKOUT)).toEqual({
      path: "/?payment=failed",
    })
  })
})
