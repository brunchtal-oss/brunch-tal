import "server-only"

import { cookies } from "next/headers"
import { NextResponse } from "next/server"

import type { ErrorCode } from "@/lib/errors"
import {
  growConfig,
  onlinePaymentsEnabled,
  type GrowConfig,
  type OnlinePaymentsEnv,
} from "@/lib/payments/online-config"
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

export const CHECKOUT_COOKIE = "bt_checkout"
const COOKIE_MAX_AGE = 60 * 60 * 24 * 7
const MAX_COOKIE_ENTRIES = 5

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const SECRET = /^[A-Za-z0-9_-]{16,200}$/

export type SecretKind = "notify" | "browser" | "system"

export type CheckoutEntry = { id: string; secret: string }

export function isCheckoutId(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value)
}

export function isCheckoutSecret(value: unknown): value is string {
  return typeof value === "string" && SECRET.test(value)
}

/** The valid entries of the `bt_checkout` cookie, newest first (at most 5). */
export function parseCheckoutCookie(
  value: string | null | undefined
): CheckoutEntry[] {
  if (!value) return []
  const entries: CheckoutEntry[] = []
  for (const part of value.split(",")) {
    const dot = part.indexOf(".")
    if (dot < 0) continue
    const id = part.slice(0, dot)
    const secret = part.slice(dot + 1)
    if (isCheckoutId(id) && isCheckoutSecret(secret)) {
      entries.push({ id, secret })
    }
  }
  return entries.slice(0, MAX_COOKIE_ENTRIES)
}

export function serializeCheckoutCookie(entries: CheckoutEntry[]): string {
  return entries
    .slice(0, MAX_COOKIE_ENTRIES)
    .map((e) => `${e.id}.${e.secret}`)
    .join(",")
}

/** The entry of checkout `c`, else null (no c, or no match). */
export function checkoutEntryFor(
  cookie: string | null | undefined,
  c: string | null | undefined
): CheckoutEntry | null {
  if (!isCheckoutId(c)) return null
  return parseCheckoutCookie(cookie).find((e) => e.id === c) ?? null
}

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
  // Sent to Grow only (name, email, phone); never stored by us.
  payer?: GrowClientInput
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
}

function growFor(deps: CheckoutDeps, config: GrowConfig): GrowClient {
  return (deps.grow ?? createGrowClient)(config)
}

// The uid of the verified session claims (never browser input), else null.
async function sessionUid(): Promise<string | null> {
  const supabase = await createClient()
  const { data } = await supabase.auth.getClaims()
  const sub = data?.claims?.sub
  return isCheckoutId(sub) ? sub : null
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
  const uid = input.as === "customer" ? await sessionUid() : null
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
      client: input.payer,
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

type ReturnRow = {
  state: CheckoutState
  product_kind: "days" | "session" | null
  event_id: string | null
  customer_known: boolean
  join_token?: string
  joined?: boolean
  join_blocked?: boolean
}

// Where a closed checkout sends the browser, with ?payment=<state>: its
// session page; without a session, "my purchases" for a known customer or
// the home page for a guest.
export function closedPathFor(
  state: string,
  eventId: string | null,
  customerKnown: boolean
): string {
  const payment = encodeURIComponent(state)
  if (eventId) return `/sessions/${eventId}?payment=${payment}`
  return customerKnown
    ? `/me/purchases?payment=${payment}`
    : `/?payment=${payment}`
}

/** The redirect of the browser return, from checkout_return's answer. */
export function returnPathFor(row: ReturnRow, pending: boolean): string {
  if (row.state === "paid") {
    if (row.join_token) return `/join/${row.join_token}`
    if (row.customer_known || row.joined) {
      return row.product_kind === "session" ? "/me/bookings" : "/me/purchases"
    }
    // Paid, but no link can be issued (a join in progress, a conflict for
    // Tal, a voided purchase).
    return closedPathFor("issue", row.event_id, false)
  }
  if (row.state === "open" || pending) return PENDING_PATH
  return closedPathFor(row.state, row.event_id, row.customer_known)
}

const PENDING_PATH = "/pay/pending"
const NOT_FOUND_PATH = "/sessions"

// The browser's next step and the cookie: undefined keeps it, a string
// replaces it, null deletes it.
export type PaymentRedirect = { path: string; cookie?: string | null }

function withoutEntry(
  cookie: string | null | undefined,
  id: string
): string | null {
  const left = parseCheckoutCookie(cookie).filter((e) => e.id !== id)
  return left.length > 0 ? serializeCheckoutCookie(left) : null
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
  const confirmed = await confirmCheckout(
    entry.id,
    entry.secret,
    "browser",
    deps
  )
  if (!confirmed.ok && confirmed.code === "CHECKOUT_NOT_FOUND") {
    return { path: NOT_FOUND_PATH }
  }

  const back = await callRpc(createServiceClient(), "checkout_return", {
    p_checkout_id: entry.id,
    p_browser_secret: entry.secret,
  })
  if (!back.ok) {
    return {
      path: back.code === "CHECKOUT_NOT_FOUND" ? NOT_FOUND_PATH : PENDING_PATH,
    }
  }
  const row = back.data as unknown as ReturnRow
  if (!confirmed.ok && row.state !== "paid") return { path: PENDING_PATH }

  const path = returnPathFor(row, confirmed.ok && confirmed.pending)
  // A join link is issued once per entry: the next return cannot take it.
  return row.join_token
    ? { path, cookie: withoutEntry(cookie, entry.id) }
    : { path }
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
    return {
      path:
        cancelled.code === "CHECKOUT_NOT_FOUND" ? NOT_FOUND_PATH : PENDING_PATH,
    }
  }
  const row = cancelled.data as unknown as {
    state: CheckoutState
    event_id: string | null
    customer_known?: boolean
  }
  // Paid already (a late failure page): the return decides.
  if (row.state === "paid") {
    return { path: `/pay/return?c=${encodeURIComponent(entry.id)}` }
  }
  return {
    path: closedPathFor(row.state, row.event_id, row.customer_known === true),
  }
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
  return response
}
