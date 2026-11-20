import "server-only"

import { cookies } from "next/headers"

import type { ErrorCode } from "@/lib/errors"
import {
  growConfig,
  onlinePaymentsEnabled,
  type GrowConfig,
  type OnlinePaymentsEnv,
} from "@/lib/payments/online-config"
import { callRpc } from "@/lib/rpc"
import { requestOrigin } from "@/lib/server/join-link"
import {
  createGrowClient,
  GrowUnavailableError,
  type GrowClient,
  type GrowClientInput,
} from "@/lib/server/privileged/grow"
import {
  clientIp,
  hitRateLimit,
  rateLimitCode,
} from "@/lib/server/privileged/rate-limit"
import { createServiceClient } from "@/lib/server/privileged/service-client"
import { createClient } from "@/lib/supabase/server"

// Online payments, the server half (spec-online-payments-grow-a.md).
//
// startCheckout: the kill switch, the guest rate limit, the begin RPC (seat
// hold for a pinned product), then the Grow form (no network call inside a
// transaction). A Grow failure cancels the checkout (the hold is released).
// The browser keeps `bt_checkout` = "<id>.<browser secret>"; the notify
// secret goes only into Grow's notifyUrl.
//
// confirmCheckout: the one confirm step of both triggers (the notification
// with the notify secret, the browser return with the browser secret). The
// notification body is never read for business data: the payment is the
// morning document found by the checkout's reference (verification is the
// source of truth). Nothing secret or personal is logged.

export const CHECKOUT_COOKIE = "bt_checkout"
const COOKIE_MAX_AGE = 60 * 60 * 24 * 7

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const SECRET = /^[A-Za-z0-9_-]{16,200}$/

export type SecretKind = "notify" | "browser"

export function isCheckoutId(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value)
}

export function isCheckoutSecret(value: unknown): value is string {
  return typeof value === "string" && SECRET.test(value)
}

/** The checkout of the `bt_checkout` cookie, else null. */
export function parseCheckoutCookie(
  value: string | null | undefined
): { id: string; secret: string } | null {
  if (!value) return null
  const dot = value.indexOf(".")
  if (dot < 0) return null
  const id = value.slice(0, dot)
  const secret = value.slice(dot + 1)
  return isCheckoutId(id) && isCheckoutSecret(secret) ? { id, secret } : null
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
  // customer: begin_checkout as the signed-in customer (her session);
  // guest: begin_guest_checkout through the service role, rate limited.
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

export async function startCheckout(
  input: StartCheckoutInput,
  deps: CheckoutDeps = {}
): Promise<StartCheckoutResult> {
  const env = deps.env ?? process.env
  const config = growConfig(env)
  if (!onlinePaymentsEnabled(env) || !config) {
    return { ok: false, code: "ONLINE_PAYMENTS_OFF" }
  }

  if (
    !isCheckoutId(input.productId) ||
    (input.eventId !== null && !isCheckoutId(input.eventId)) ||
    !isCheckoutId(input.idempotencyKey)
  ) {
    return { ok: false, code: "INVALID_INPUT" }
  }

  if (input.as === "guest") {
    const ip = await clientIp()
    const stop = rateLimitCode(await hitRateLimit("checkout", { ip, id: ip }))
    if (stop) return { ok: false, code: stop }
  }

  const origin = await requestOrigin()
  if (!origin) return { ok: false, code: "SERVER_ERROR" }

  const args = {
    p_product_id: input.productId,
    p_event_id: input.eventId as string,
    p_terms_accepted: input.termsAccepted,
    p_idempotency_key: input.idempotencyKey,
  }
  const begun =
    input.as === "customer"
      ? await callRpc(await createClient(), "begin_checkout", args)
      : await callRpc(createServiceClient(), "begin_guest_checkout", args)
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

  const notifyUrl = new URL("/api/payments/grow", origin)
  notifyUrl.searchParams.set("c", checkout.checkout_id)
  notifyUrl.searchParams.set("s", notifySecret)

  let url: string
  try {
    url = await growFor(deps, config).createPaymentForm({
      description: `${checkout.product_name} · ${checkout.reference}`,
      amountAgorot: checkout.amount_agorot,
      client: input.payer,
      successUrl: new URL("/pay/return", origin).href,
      failureUrl: new URL("/pay/failed", origin).href,
      notifyUrl: notifyUrl.href,
      custom: checkout.checkout_id,
    })
  } catch (error) {
    if (!(error instanceof GrowUnavailableError)) {
      console.error("checkout.failed", { step: "payment_form" })
    }
    // The hold is released at once; a failure here is logged by callRpc.
    await callRpc(createServiceClient(), "cancel_checkout", {
      p_checkout_id: checkout.checkout_id,
      p_browser_secret: browserSecret,
    })
    return { ok: false, code: "GROW_UNAVAILABLE" }
  }

  const store = await cookies()
  store.set(CHECKOUT_COOKIE, `${checkout.checkout_id}.${browserSecret}`, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: COOKIE_MAX_AGE,
  })

  return { ok: true, data: { kind: "redirect", url } }
}

export type CheckoutState = "open" | "paid" | "failed" | "expired" | "issue"

export type ConfirmResult =
  | {
      ok: true
      state: CheckoutState
      // No document at morning yet (the notification answers 503 so Grow
      // retries; the return shows "pending").
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

export async function confirmCheckout(
  checkoutId: string,
  secret: string,
  kind: SecretKind,
  deps: CheckoutDeps = {}
): Promise<ConfirmResult> {
  if (!isCheckoutId(checkoutId) || !isCheckoutSecret(secret)) {
    return { ok: false, code: "CHECKOUT_NOT_FOUND" }
  }
  const service = createServiceClient()

  // The unconfirmed safety net: written first, in its own short call.
  if (kind === "notify") {
    const marked = await callRpc(service, "mark_checkout_notified", {
      p_checkout_id: checkoutId,
      p_notify_secret: secret,
    })
    if (!marked.ok) {
      return {
        ok: false,
        code:
          marked.code === "CHECKOUT_NOT_FOUND" ? marked.code : "SERVER_ERROR",
      }
    }
  }

  const read = await callRpc(service, "checkout_for_confirm", {
    p_checkout_id: checkoutId,
    p_secret: secret,
    p_secret_kind: kind,
  })
  if (!read.ok) {
    return {
      ok: false,
      code: read.code === "CHECKOUT_NOT_FOUND" ? read.code : "SERVER_ERROR",
    }
  }
  const row = read.data as unknown as ConfirmRow

  const config = growConfig(deps.env ?? process.env)
  if (!config) return { ok: false, code: "GROW_UNAVAILABLE" }

  let search: Awaited<ReturnType<GrowClient["findCheckoutDocument"]>>
  try {
    search = await growFor(deps, config).findCheckoutDocument(
      row.reference,
      row.created_on
    )
  } catch {
    return { ok: false, code: "GROW_UNAVAILABLE" }
  }

  // Not at morning yet. A failed or expired checkout may still be paid (a
  // late payment lands), so it is pending too; a paid one is done.
  if (search.kind === "none") {
    return {
      ok: true,
      state: row.state,
      pending: row.state !== "paid" && row.state !== "issue",
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
    p_secret: secret,
    p_secret_kind: kind,
    ...args,
  })
  if (!recorded.ok) {
    return {
      ok: false,
      code:
        recorded.code === "CHECKOUT_NOT_FOUND" ? recorded.code : "SERVER_ERROR",
    }
  }
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

// Where a closed checkout sends the browser: its session page, or "my
// purchases" without a session, with ?payment=<state>.
export function closedPathFor(state: string, eventId: string | null): string {
  const payment = encodeURIComponent(state)
  return eventId
    ? `/sessions/${eventId}?payment=${payment}`
    : `/me/purchases?payment=${payment}`
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
    return closedPathFor("issue", row.event_id)
  }
  if (row.state === "open" || pending) return "/pay/pending"
  return closedPathFor(row.state, row.event_id)
}

const PENDING_PATH = "/pay/pending"
const NOT_FOUND_PATH = "/sessions"

/** GET /pay/return: confirm, then where she goes. */
export async function returnFromPayment(
  cookie: string | null | undefined,
  deps: CheckoutDeps = {}
): Promise<string> {
  const parsed = parseCheckoutCookie(cookie)
  if (!parsed) return NOT_FOUND_PATH

  const confirmed = await confirmCheckout(
    parsed.id,
    parsed.secret,
    "browser",
    deps
  )
  if (!confirmed.ok) {
    return confirmed.code === "CHECKOUT_NOT_FOUND"
      ? NOT_FOUND_PATH
      : PENDING_PATH
  }

  const back = await callRpc(createServiceClient(), "checkout_return", {
    p_checkout_id: parsed.id,
    p_browser_secret: parsed.secret,
  })
  if (!back.ok) {
    return back.code === "CHECKOUT_NOT_FOUND" ? NOT_FOUND_PATH : PENDING_PATH
  }
  return returnPathFor(back.data as unknown as ReturnRow, confirmed.pending)
}

/** GET /pay/failed: the checkout fails (hold released), then the notice. */
export async function failFromPayment(
  cookie: string | null | undefined
): Promise<string> {
  const parsed = parseCheckoutCookie(cookie)
  if (!parsed) return NOT_FOUND_PATH

  const cancelled = await callRpc(createServiceClient(), "cancel_checkout", {
    p_checkout_id: parsed.id,
    p_browser_secret: parsed.secret,
  })
  if (!cancelled.ok) {
    return cancelled.code === "CHECKOUT_NOT_FOUND"
      ? NOT_FOUND_PATH
      : PENDING_PATH
  }
  const row = cancelled.data as unknown as {
    state: CheckoutState
    event_id: string | null
  }
  // Paid already (a late failure page): the return decides.
  if (row.state === "paid") return "/pay/return"
  return closedPathFor(row.state, row.event_id)
}
