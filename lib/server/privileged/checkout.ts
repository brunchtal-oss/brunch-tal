import "server-only"

import { cookies } from "next/headers"
import { NextResponse } from "next/server"

import type { ErrorCode } from "@/lib/errors"
import {
  CHECKOUT_COOKIE,
  checkoutEntryFor,
  isCheckoutId,
  isCheckoutSecret,
  outcomeOfPath,
  parseCheckoutCookie,
  PAYMENT_OUTCOME_COOKIE,
  PAYMENT_OUTCOME_MAX_AGE,
  serializeCheckoutCookie,
  serializePaymentOutcome,
  withoutCheckoutEntry,
  type PaymentKind,
  type PaymentOutcome,
} from "@/lib/payments/checkout-cookie"
import {
  growConfig,
  onlinePaymentsEnabled,
  type GrowConfig,
  type OnlinePaymentsEnv,
} from "@/lib/payments/online-config"
import {
  NO_PURCHASE,
  parsePurchaseOptions,
  payerShape,
  type PayerInput,
  type PurchaseOptions,
} from "@/lib/payments/purchase-options"
import { callRpc } from "@/lib/rpc"
import {
  createGrowClient,
  GrowUnavailableError,
  type GrowClient,
  type GrowClientInput,
} from "@/lib/server/privileged/grow"
import {
  clientIp,
  hitRateLimit,
  peekRateLimit,
  rateLimitCode,
} from "@/lib/server/privileged/rate-limit"
import { createServiceClient } from "@/lib/server/privileged/service-client"
import { explicitSiteUrl } from "@/lib/site-url"
import { createClient } from "@/lib/supabase/server"

// Online payments, the server half (spec-online-payments-grow-a.md).
//
// startCheckout: the kill switch, the guest rate limit, the begin RPC (seat
// hold for a pinned product), then the Grow form (no network call inside a
// transaction). A Grow failure cancels the checkout (the hold is released).
// Every RPC runs through the service role, so the kill switch is enforced
// here before any row exists; a customer's checkout passes the uid of her
// verified session claims. The URLs are built from NEXT_PUBLIC_SITE_URL,
// never from request headers.
//
// The browser keeps `bt_checkout`: up to 5 "<id>.<browser secret>" entries,
// newest first. successUrl / failureUrl carry ?c=<checkout id>, and the
// return uses only the matching entry. The notify secret goes only into
// Grow's notifyUrl.
//
// confirmCheckout: the one confirm step of every trigger (the notification
// with the notify secret, the browser return with the browser secret, the
// reconciliation job with kind 'system'). The notification body is never
// read for business data: the payment is the morning document found by
// the checkout's reference. Nothing secret or personal is logged.

const COOKIE_MAX_AGE = 60 * 60 * 24 * 7

export type SecretKind = "notify" | "browser" | "system"

// The pure cookie helpers live in lib/payments/checkout-cookie.ts (the
// banner reads them too); re-exported for the routes and the tests.
export {
  CHECKOUT_COOKIE,
  checkoutEntryFor,
  isCheckoutId,
  isCheckoutSecret,
  parseCheckoutCookie,
  serializeCheckoutCookie,
  type CheckoutEntry,
} from "@/lib/payments/checkout-cookie"

/** The cookie's options: `secure` only when the site is https. */
export function checkoutCookieOptions(env: OnlinePaymentsEnv = process.env) {
  return {
    httpOnly: true,
    secure: (explicitSiteUrl(env) ?? "").startsWith("https://"),
    sameSite: "lax" as const,
    path: "/",
    maxAge: COOKIE_MAX_AGE,
  }
}

type BeginResult = {
  checkout_id: string
  reference: string
  amount_agorot: number
  product_name: string
  product_kind: "days" | "session"
  event_id: string | null
  pay_until: string
  notify_secret?: string
  browser_secret?: string
  reissue_required: boolean
}

export type StartCheckoutInput = {
  // customer: begin_checkout with the uid of her verified session claims;
  // guest: begin_guest_checkout, rate limited. Both through the service
  // role.
  as: "customer" | "guest"
  productId: string
  eventId: string | null
  termsAccepted: boolean
  idempotencyKey: string
  // A guest's name and email (required for a guest, ignored for a
  // customer, whose own come from her profile and claims). Grow refuses a
  // form without a client name (errorCode 2201). Sent to Grow only; never
  // stored, logged, audited or put in a cookie.
  payer?: PayerInput
}

export type StartCheckoutData =
  | { kind: "redirect"; url: string }
  // The same idempotency key came again: the first call already opened the
  // form (its secrets are not stored, AD-10).
  | { kind: "replayed" }

export type StartCheckoutResult =
  { ok: true; data: StartCheckoutData } | { ok: false; code: ErrorCode }

export type CheckoutDeps = {
  env?: OnlinePaymentsEnv
  grow?: (config: GrowConfig) => GrowClient
  // Tests only: the browser return's wait between looks.
  sleep?: (ms: number) => Promise<void>
}

function growFor(deps: CheckoutDeps, config: GrowConfig): GrowClient {
  return (deps.grow ?? createGrowClient)(config)
}

// The uid and email of the verified session claims (never browser input),
// else null.
async function sessionIdentity(): Promise<{
  uid: string
  email: string | null
} | null> {
  const supabase = await createClient()
  const { data } = await supabase.auth.getClaims()
  const sub = data?.claims?.sub
  if (!isCheckoutId(sub)) return null
  const email = data?.claims?.email
  return { uid: sub, email: typeof email === "string" && email ? email : null }
}

async function sessionUid(): Promise<string | null> {
  return (await sessionIdentity())?.uid ?? null
}

// A customer's Grow client: her profile's name and her claims' email. null
// when the profile cannot be read (logged without any personal detail).
async function customerPayer(
  service: ReturnType<typeof createServiceClient>,
  uid: string,
  email: string | null
): Promise<GrowClientInput | null> {
  const { data, error } = await service
    .from("profiles")
    .select("full_name")
    .eq("id", uid)
    .maybeSingle()
  const name =
    !error && typeof data?.full_name === "string" ? data.full_name.trim() : ""
  if (!name) {
    console.error("checkout.payer_failed", { found: !error && data !== null })
    return null
  }
  return { name, ...(email ? { emails: [email] } : {}) }
}

export async function startCheckout(
  input: StartCheckoutInput,
  deps: CheckoutDeps = {}
): Promise<StartCheckoutResult> {
  const env = deps.env ?? process.env
  const config = growConfig(env)
  const site = explicitSiteUrl(env)
  if (!onlinePaymentsEnabled(env) || !config || !site) {
    return { ok: false, code: "ONLINE_PAYMENTS_OFF" }
  }

  if (
    !isCheckoutId(input.productId) ||
    (input.eventId !== null && !isCheckoutId(input.eventId)) ||
    !isCheckoutId(input.idempotencyKey)
  ) {
    return { ok: false, code: "INVALID_INPUT" }
  }
  // A guest's name and email are checked again here (the sheet checked
  // them too); nothing is created without them.
  const guestPayer = input.as === "guest" ? payerShape(input.payer) : null
  if (input.as === "guest" && !guestPayer) {
    return { ok: false, code: "INVALID_INPUT" }
  }

  const service = createServiceClient()
  const args = {
    p_product_id: input.productId,
    p_event_id: input.eventId as string,
    p_terms_accepted: input.termsAccepted,
    p_idempotency_key: input.idempotencyKey,
  }

  // The checkout bucket (an hour): 10 per IP; a customer also by her uid,
  // 3. Checked here without counting; counted only once the checkout and
  // its Grow form exist, so a failed attempt costs nothing.
  const identity = input.as === "customer" ? await sessionIdentity() : null
  const uid = identity?.uid ?? null
  if (input.as === "customer" && !uid) {
    return { ok: false, code: "NOT_AUTHORIZED" }
  }
  const ip = await clientIp()
  const limitKeys = { ip, id: uid }
  const stop = rateLimitCode(await peekRateLimit("checkout", limitKeys))
  if (stop) {
    return {
      ok: false,
      code: stop === "TOO_MANY_ATTEMPTS" ? "CHECKOUT_TOO_MANY" : stop,
    }
  }

  // Grow's client, before any row exists. A customer always has a name
  // (profiles.full_name is not null and not blank); an unreadable profile
  // refuses with SERVER_ERROR and creates nothing.
  let payer: GrowClientInput
  if (identity) {
    const named = await customerPayer(service, identity.uid, identity.email)
    if (!named) return { ok: false, code: "SERVER_ERROR" }
    payer = named
  } else {
    const guest = guestPayer as PayerInput
    payer = { name: guest.name, emails: [guest.email] }
  }

  let begun: Awaited<ReturnType<typeof callRpc<"begin_checkout">>>
  if (!uid) {
    begun = await callRpc(service, "begin_guest_checkout", args)
  } else {
    begun = await callRpc(service, "begin_checkout", {
      p_auth_uid: uid,
      ...args,
    })
  }
  if (!begun.ok) return { ok: false, code: begun.code }

  const checkout = begun.data as unknown as BeginResult
  if (checkout.reissue_required) {
    return { ok: true, data: { kind: "replayed" } }
  }
  const notifySecret = checkout.notify_secret
  const browserSecret = checkout.browser_secret
  if (
    !isCheckoutId(checkout.checkout_id) ||
    !isCheckoutSecret(notifySecret) ||
    !isCheckoutSecret(browserSecret)
  ) {
    return { ok: false, code: "SERVER_ERROR" }
  }

  const notifyUrl = new URL("/api/payments/grow", site)
  notifyUrl.searchParams.set("c", checkout.checkout_id)
  notifyUrl.searchParams.set("s", notifySecret)
  const backUrl = (path: string) => {
    const url = new URL(path, site)
    url.searchParams.set("c", checkout.checkout_id)
    return url.href
  }

  let url: string
  try {
    url = await growFor(deps, config).createPaymentForm({
      description: `${checkout.reference} · ${checkout.product_name}`,
      amountAgorot: checkout.amount_agorot,
      client: payer,
      successUrl: backUrl("/pay/return"),
      failureUrl: backUrl("/pay/failed"),
      notifyUrl: notifyUrl.href,
      custom: checkout.checkout_id,
    })
  } catch (error) {
    if (!(error instanceof GrowUnavailableError)) {
      console.error("checkout.failed", { step: "payment_form" })
    }
    await cancelCheckout(service, checkout.checkout_id, browserSecret)
    return { ok: false, code: "GROW_UNAVAILABLE" }
  }

  // Reconciliation looks only at checkouts that got a form, so without the
  // mark the begin fails: the checkout is cancelled, no redirect, no cookie.
  const marked = await callRpc(service, "mark_checkout_form_created", {
    p_checkout_id: checkout.checkout_id,
    p_browser_secret: browserSecret,
  })
  if (!marked.ok) {
    console.error("checkout.form_mark_failed", { code: marked.code })
    await cancelCheckout(service, checkout.checkout_id, browserSecret)
    return { ok: false, code: "GROW_UNAVAILABLE" }
  }

  // Counted now (its own failure is logged by the limiter).
  await hitRateLimit("checkout", limitKeys)

  const store = await cookies()
  const kept = parseCheckoutCookie(store.get(CHECKOUT_COOKIE)?.value).filter(
    (e) => e.id !== checkout.checkout_id
  )
  store.set(
    CHECKOUT_COOKIE,
    serializeCheckoutCookie([
      { id: checkout.checkout_id, secret: browserSecret },
      ...kept,
    ]),
    checkoutCookieOptions(env)
  )

  return { ok: true, data: { kind: "redirect", url } }
}

// PR B: the purchase sheet's products (get_purchase_options). Nothing
// while the kill switch is off (no RPC call); a customer's uid comes from
// her verified session claims only, never from the input. A read error is
// logged with its code and offers nothing.
export async function purchaseOptions(
  as: "customer" | "guest",
  eventId: string | null,
  deps: CheckoutDeps = {}
): Promise<PurchaseOptions> {
  const env = deps.env ?? process.env
  if (!onlinePaymentsEnabled(env) || !explicitSiteUrl(env)) return NO_PURCHASE
  if (eventId !== null && !isCheckoutId(eventId)) return NO_PURCHASE
  const uid = as === "customer" ? await sessionUid() : null
  if (as === "customer" && !uid) return NO_PURCHASE
  const read = await callRpc(createServiceClient(), "get_purchase_options", {
    p_event_id: eventId as string,
    p_auth_uid: uid as string,
  })
  if (!read.ok) {
    console.error("checkout.options_failed", { code: read.code })
    return NO_PURCHASE
  }
  return parsePurchaseOptions(read.data)
}

/**
 * The sheet's pay button: the product must be one the sheet may offer
 * (enabled, published purchase terms, intro rules; get_purchase_options
 * for the same event, or the cards without one), then startCheckout.
 */
export async function startPurchase(
  input: StartCheckoutInput,
  deps: CheckoutDeps = {}
): Promise<StartCheckoutResult> {
  const env = deps.env ?? process.env
  if (!onlinePaymentsEnabled(env))
    return { ok: false, code: "ONLINE_PAYMENTS_OFF" }
  if (
    !isCheckoutId(input.productId) ||
    (input.eventId !== null && !isCheckoutId(input.eventId)) ||
    !isCheckoutId(input.idempotencyKey) ||
    typeof input.termsAccepted !== "boolean"
  ) {
    return { ok: false, code: "INVALID_INPUT" }
  }
  if (!input.termsAccepted) return { ok: false, code: "TERMS_REQUIRED" }
  // The guest path is for guests only: a signed-in caller buys from her
  // area (review pass 1).
  if (input.as === "guest" && (await sessionUid())) {
    return { ok: false, code: "NOT_AUTHORIZED" }
  }
  const options = await purchaseOptions(input.as, input.eventId, deps)
  if (!options.enabled) {
    return { ok: false, code: "ONLINE_PAYMENTS_OFF" }
  }
  const product = options.products.find((p) => p.id === input.productId)
  if (!product) {
    return { ok: false, code: "PRODUCT_NOT_PURCHASABLE" }
  }
  // A card is bought without a session, whatever the page sent.
  return startCheckout(
    {
      ...input,
      eventId: product.validityMode === "days" ? null : input.eventId,
      // A customer's details come from her profile, never from the page.
      payer: input.as === "guest" ? input.payer : undefined,
    },
    deps
  )
}

// The "continue joining" banner (review pass 1): the newest cookie entry
// whose checkout is paid, its payment not bound to a customer yet, created
// within 24 hours (checkout_banner_state, read only), else null. Nothing
// while the kill switch is off (no call).
export async function checkoutBannerId(
  deps: CheckoutDeps = {}
): Promise<string | null> {
  if (!onlinePaymentsEnabled(deps.env ?? process.env)) return null
  const store = await cookies()
  const entries = parseCheckoutCookie(store.get(CHECKOUT_COOKIE)?.value)
  if (entries.length === 0) return null
  const service = createServiceClient()
  for (const entry of entries) {
    const state = await callRpc(service, "checkout_banner_state", {
      p_checkout_id: entry.id,
      p_browser_secret: entry.secret,
    })
    if (!state.ok) {
      console.error("checkout.banner_failed", { code: state.code })
      return null
    }
    if ((state.data as { show?: unknown } | null)?.show === true) {
      return entry.id
    }
  }
  return null
}

// Releases the hold of a checkout that will not be paid; a failure is
// logged with the code only.
async function cancelCheckout(
  service: ReturnType<typeof createServiceClient>,
  checkoutId: string,
  browserSecret: string
): Promise<void> {
  const cancelled = await callRpc(service, "cancel_checkout", {
    p_checkout_id: checkoutId,
    p_browser_secret: browserSecret,
  })
  if (!cancelled.ok) {
    console.error("checkout.cancel_failed", { code: cancelled.code })
  }
}

export type CheckoutState = "open" | "paid" | "failed" | "expired" | "issue"

export type ConfirmResult =
  | {
      ok: true
      state: CheckoutState
      // No document at morning yet, and Grow may still be asked to retry
      // (the notification answers 503; the return shows "pending").
      pending: boolean
    }
  | {
      ok: false
      code: "CHECKOUT_NOT_FOUND" | "GROW_UNAVAILABLE" | "SERVER_ERROR"
    }

type ConfirmRow = {
  state: CheckoutState
  reference: string
  amount_agorot: number
  created_on: string
}

function notFoundOr(code: ErrorCode): "CHECKOUT_NOT_FOUND" | "SERVER_ERROR" {
  return code === "CHECKOUT_NOT_FOUND" ? code : "SERVER_ERROR"
}

// secret is ignored for kind 'system' (the reconciliation job, service role).
export async function confirmCheckout(
  checkoutId: string,
  secret: string | null,
  kind: SecretKind,
  deps: CheckoutDeps = {}
): Promise<ConfirmResult> {
  if (
    !isCheckoutId(checkoutId) ||
    (kind !== "system" && !isCheckoutSecret(secret))
  ) {
    return { ok: false, code: "CHECKOUT_NOT_FOUND" }
  }
  const service = createServiceClient()
  const rpcSecret = (kind === "system" ? null : secret) as string

  // The unconfirmed safety net: written first, in its own short call. After
  // 30 minutes (or once the checkout is closed) Grow is not asked to retry.
  let retryAllowed = true
  if (kind === "notify") {
    const marked = await callRpc(service, "mark_checkout_notified", {
      p_checkout_id: checkoutId,
      p_notify_secret: rpcSecret,
    })
    if (!marked.ok) return { ok: false, code: notFoundOr(marked.code) }
    retryAllowed =
      (marked.data as { retry_allowed?: unknown } | null)?.retry_allowed ===
      true
  }

  const read = await callRpc(service, "checkout_for_confirm", {
    p_checkout_id: checkoutId,
    p_secret: rpcSecret,
    p_secret_kind: kind,
  })
  if (!read.ok) return { ok: false, code: notFoundOr(read.code) }
  const row = read.data as unknown as ConfirmRow

  const config = growConfig(deps.env ?? process.env)
  if (!config) {
    return retryAllowed
      ? { ok: false, code: "GROW_UNAVAILABLE" }
      : { ok: true, state: row.state, pending: false }
  }

  let search: Awaited<ReturnType<GrowClient["findCheckoutDocument"]>>
  try {
    search = await growFor(deps, config).findCheckoutDocument(
      row.reference,
      row.created_on
    )
  } catch {
    return retryAllowed
      ? { ok: false, code: "GROW_UNAVAILABLE" }
      : { ok: true, state: row.state, pending: false }
  }

  // Not at morning yet. A failed or expired checkout may still be paid (a
  // late payment lands), so it is pending too; a paid one is done.
  if (search.kind === "none") {
    return {
      ok: true,
      state: row.state,
      pending: retryAllowed && row.state !== "paid" && row.state !== "issue",
    }
  }

  const args =
    search.kind === "many"
      ? {
          p_document_id: null as unknown as string,
          p_outcome: "not_verified",
          p_amount_agorot: null as unknown as number,
          p_paid_at: null as unknown as string,
        }
      : {
          p_document_id: search.document.id,
          p_outcome:
            search.document.currency === "ILS" &&
            search.document.amountAgorot === row.amount_agorot
              ? "verified"
              : "amount_mismatch",
          p_amount_agorot: search.document.amountAgorot as number,
          p_paid_at: search.document.paidAt,
        }

  const recorded = await callRpc(service, "record_online_payment", {
    p_checkout_id: checkoutId,
    p_secret: rpcSecret,
    p_secret_kind: kind,
    ...args,
  })
  if (!recorded.ok) return { ok: false, code: notFoundOr(recorded.code) }
  const state = (recorded.data as { state?: CheckoutState } | null)?.state
  return { ok: true, state: state ?? row.state, pending: false }
}

export type ReturnRow = {
  state: CheckoutState
  product_kind: "days" | "session" | null
  event_id: string | null
  customer_known: boolean
  // PR B: the paid purchase got its booking (false when parked).
  booked?: boolean
  // Review pass 2: money was received (a payment, or a morning document on
  // an issue); and the return stopped waiting for a document (30 minutes
  // after the pay window and the hold grace).
  has_payment?: boolean
  pending_over?: boolean
  join_token?: string
  joined?: boolean
  join_blocked?: boolean
}

// Where a closed checkout sends the browser, with ?payment=<state>: a
// known customer to her area (the session's page there, else "my
// purchases"); a guest to the public session page, else the home page.
export function closedPathFor(
  state: string,
  eventId: string | null,
  customerKnown: boolean
): string {
  const payment = encodeURIComponent(state)
  if (customerKnown) {
    return eventId
      ? `/me/sessions/${eventId}?payment=${payment}`
      : `/me/purchases?payment=${payment}`
  }
  return eventId
    ? `/sessions/${eventId}?payment=${payment}`
    : `/?payment=${payment}`
}

/** /pay/pending for checkout `id` ("לבדוק שוב" returns with the same c). */
export function pendingPathFor(id: string): string {
  return `${PENDING_PATH}?c=${encodeURIComponent(id)}`
}

/**
 * The redirect of the browser return (Grow's success URL), from
 * checkout_return's answer, and whether it is a final outcome (the cookie
 * entry is then removed). Review pass 2: an unpaid checkout (open, failed
 * or expired) is pending here, never "failed": the document may lag behind
 * a real charge. Pending ends 30 minutes after the pay window and the hold
 * grace (pending_over) with the neutral not_found notice. An issue without
 * money received gets the neutral review notice.
 */
export function returnPathFor(
  row: ReturnRow,
  pending: boolean,
  checkoutId: string
): { path: string; final: boolean } {
  if (row.state === "paid") {
    if (row.join_token) return { path: `/join/${row.join_token}`, final: true }
    if (row.customer_known || row.joined) {
      // A known customer: her area with the success notice; a pinned
      // purchase parked without a place gets the no_place notice.
      if (row.product_kind === "session") {
        // A missing `booked` reads as booked (only false is a parked one).
        return {
          path:
            row.booked !== false
              ? "/me/bookings?payment=paid"
              : "/me/bookings?payment=no_place",
          final: true,
        }
      }
      return { path: "/me/purchases?payment=paid", final: true }
    }
    // Paid, but no link can be issued (a join in progress, a conflict for
    // Tal, a voided purchase).
    return {
      path: closedPathFor("issue", row.event_id, row.customer_known),
      final: true,
    }
  }
  if (
    row.state === "open" ||
    row.state === "failed" ||
    row.state === "expired" ||
    pending
  ) {
    if (row.pending_over === true) {
      return {
        path: closedPathFor("not_found", row.event_id, row.customer_known),
        final: true,
      }
    }
    return { path: pendingPathFor(checkoutId), final: false }
  }
  const state =
    row.state === "issue" && row.has_payment === false ? "review" : row.state
  return {
    path: closedPathFor(state, row.event_id, row.customer_known),
    final: true,
  }
}

// The waits before each further look on the browser return (about 10
// seconds in all: a sandbox receipt took longer than 3 seconds, 2026-11-21).
export const RETURN_WAITS_MS = [1000, 2000, 3000, 4000] as const

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

const PENDING_PATH = "/pay/pending"
const NOT_FOUND_PATH = "/sessions"

// The browser's next step and the cookie: undefined keeps it, a string
// replaces it, null deletes it.
// outcome: the one-minute outcome cookie (the notice's proof of a real
// return), set for a ?payment= redirect.
export type PaymentRedirect = {
  path: string
  cookie?: string | null
  outcome?: PaymentOutcome
}

function kindOf(productKind: string | null | undefined): PaymentKind {
  return productKind === "session" ? "session" : "card"
}

// The redirect with its outcome cookie when the path carries ?payment=.
function withOutcome(
  redirect: PaymentRedirect,
  productKind: string | null | undefined
): PaymentRedirect {
  const outcome = outcomeOfPath(redirect.path, kindOf(productKind))
  return outcome ? { ...redirect, outcome } : redirect
}

// The redirect with checkout `id` removed from the cookie.
function removing(
  path: string,
  cookie: string | null | undefined,
  id: string
): PaymentRedirect {
  return { path, cookie: withoutCheckoutEntry(cookie, id) }
}

/** GET /pay/return?c=<checkout>: confirm, then where she goes. */
export async function returnFromPayment(
  cookie: string | null | undefined,
  c: string | null | undefined,
  deps: CheckoutDeps = {}
): Promise<PaymentRedirect> {
  const entry = checkoutEntryFor(cookie, c)
  if (!entry) return { path: NOT_FOUND_PATH }

  // Morning down or a database error still reads the checkout's state: a
  // paid one goes on to her join link or her area.
  let confirmed = await confirmCheckout(entry.id, entry.secret, "browser", deps)
  // Grow sends the browser back about when it creates the receipt, so the
  // first look often finds nothing (sandbox 2026-11-21, user decision):
  // with no document yet, look again a few times (about 3 seconds in all)
  // before the pending page.
  for (const wait of RETURN_WAITS_MS) {
    if (!(confirmed.ok && confirmed.pending)) break
    await (deps.sleep ?? sleep)(wait)
    confirmed = await confirmCheckout(entry.id, entry.secret, "browser", deps)
  }
  // The checkout is gone (or its secret does not match): its entry is
  // useless, so it leaves the cookie.
  if (!confirmed.ok && confirmed.code === "CHECKOUT_NOT_FOUND") {
    return removing(NOT_FOUND_PATH, cookie, entry.id)
  }

  const back = await callRpc(createServiceClient(), "checkout_return", {
    p_checkout_id: entry.id,
    p_browser_secret: entry.secret,
  })
  if (!back.ok) {
    return back.code === "CHECKOUT_NOT_FOUND"
      ? removing(NOT_FOUND_PATH, cookie, entry.id)
      : { path: pendingPathFor(entry.id) }
  }
  const row = back.data as unknown as ReturnRow
  if (!confirmed.ok && row.state !== "paid") {
    return { path: pendingPathFor(entry.id) }
  }

  // Review pass 2 (reverses pass 1): with no document yet, a failed or
  // expired checkout is pending too, the entry kept, until pending_over.
  const next = returnPathFor(row, confirmed.ok && confirmed.pending, entry.id)
  // A final outcome ends the entry: a join link is issued once per entry,
  // and the "continue joining" banner stops.
  return next.final
    ? withOutcome(removing(next.path, cookie, entry.id), row.product_kind)
    : { path: next.path }
}

/** GET /pay/failed?c=<checkout>: only that checkout fails, then the notice. */
export async function failFromPayment(
  cookie: string | null | undefined,
  c: string | null | undefined
): Promise<PaymentRedirect> {
  const entry = checkoutEntryFor(cookie, c)
  if (!entry) return { path: NOT_FOUND_PATH }

  const cancelled = await callRpc(createServiceClient(), "cancel_checkout", {
    p_checkout_id: entry.id,
    p_browser_secret: entry.secret,
  })
  if (!cancelled.ok) {
    return cancelled.code === "CHECKOUT_NOT_FOUND"
      ? removing(NOT_FOUND_PATH, cookie, entry.id)
      : { path: pendingPathFor(entry.id) }
  }
  const row = cancelled.data as unknown as {
    state: CheckoutState
    product_kind?: string | null
    event_id: string | null
    customer_known?: boolean
  }
  // Paid already (a late failure page): the return decides (the entry
  // stays for it).
  if (row.state === "paid") {
    return { path: `/pay/return?c=${encodeURIComponent(entry.id)}` }
  }
  // Failed, expired or an issue: final, the entry leaves the cookie. Only
  // Grow's failure URL says "failed" ("לא חויבת"); an issue here gets the
  // neutral review notice (whether money came is not known here).
  return withOutcome(
    removing(
      closedPathFor(
        row.state === "issue" ? "review" : row.state,
        row.event_id,
        row.customer_known === true
      ),
      cookie,
      entry.id
    ),
    row.product_kind
  )
}

/** The 303 of /pay/return and /pay/failed, with the cookie change. No
 * referrer, no cache (a join token may be in Location). */
export function paymentRedirectResponse(
  redirect: PaymentRedirect,
  requestUrl: string,
  env: OnlinePaymentsEnv = process.env
): NextResponse {
  const response = NextResponse.redirect(
    new URL(redirect.path, requestUrl),
    303
  )
  response.headers.set("Cache-Control", "no-store")
  response.headers.set("Referrer-Policy", "no-referrer")
  if (typeof redirect.cookie === "string") {
    response.cookies.set(
      CHECKOUT_COOKIE,
      redirect.cookie,
      checkoutCookieOptions(env)
    )
  } else if (redirect.cookie === null) {
    response.cookies.set(CHECKOUT_COOKIE, "", {
      ...checkoutCookieOptions(env),
      maxAge: 0,
    })
  }
  if (redirect.outcome) {
    response.cookies.set(
      PAYMENT_OUTCOME_COOKIE,
      serializePaymentOutcome(redirect.outcome),
      { ...checkoutCookieOptions(env), maxAge: PAYMENT_OUTCOME_MAX_AGE }
    )
  }
  return response
}
