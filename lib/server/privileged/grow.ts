import "server-only"

import { agorotToProviderAmount, providerAmountToAgorot } from "@/lib/money"
import type { GrowConfig } from "@/lib/payments/online-config"

// The Grow (morning) API client (OpenAPI at
// developers.morning.co/docs/openapi.bundled.json, read 2026-11-20). Server
// only: it holds the client secret. Never logs a secret, a token, a URL with
// a secret, or payer data: only the operation and an HTTP status.
//
// - Token: POST {idp}/idp/v1/oauth/token (client credentials), valid one
//   hour; cached until 60 seconds before expiresAt.
// - createPaymentForm: POST {api}/payments/form -> the hosted form's URL.
// - findCheckoutDocument: POST {api}/documents/search by the checkout's
//   reference; the caller decides what a match means for the payment.

const TIMEOUT_MS = 10_000
const TOKEN_MARGIN_MS = 60_000
// morning's document statuses: 3 a cancelling document, 4 cancelled.
const CANCELLED_STATUSES = new Set([3, 4])

export class GrowUnavailableError extends Error {
  constructor(
    readonly op: string,
    readonly status: number | null
  ) {
    super(`grow ${op} failed`)
    this.name = "GrowUnavailableError"
  }
}

export type GrowClientInput = {
  name?: string
  emails?: string[]
  phone?: string
}

export type PaymentFormInput = {
  description: string
  amountAgorot: number
  client?: GrowClientInput
  successUrl: string
  failureUrl: string
  notifyUrl: string
  // Echoed by Grow to the three URLs: the checkout id.
  custom: string
}

export type GrowDocument = {
  id: string
  // null when the amount is not a valid sum.
  amountAgorot: number | null
  currency: string
  // When morning created it (creationDate, Unix seconds), else noon UTC of
  // its documentDate (the same day in Israel). Only the local date is used
  // (paid_on).
  paidAt: string
}

export type DocumentSearch =
  { kind: "none" } | { kind: "one"; document: GrowDocument } | { kind: "many" }

export type GrowDeps = {
  fetch?: typeof fetch
  now?: () => number
}

type CachedToken = { token: string; expiresAtMs: number }

// The token of each client id, shared by the clients of one server process.
const tokenCache = new Map<string, CachedToken>()

/** Tests only: forget the cached tokens. */
export function clearGrowTokenCache(): void {
  tokenCache.clear()
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

// The reference as a whole token of the description ("<product> · BT-…"):
// BT-AB12 never matches BT-AB123.
export function descriptionHasReference(
  description: unknown,
  reference: string
): boolean {
  if (typeof description !== "string") return false
  return description.split(/[\s·]+/).includes(reference)
}

export function createGrowClient(config: GrowConfig, deps: GrowDeps = {}) {
  const doFetch = deps.fetch ?? globalThis.fetch
  const now = deps.now ?? Date.now
  const cacheKey = `${config.env}:${config.clientId}`

  async function post(
    op: string,
    url: string,
    body: unknown,
    token: string | null
  ): Promise<unknown> {
    let response: Response
    try {
      response = await doFetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
        cache: "no-store",
      })
    } catch {
      console.error("grow.failed", { op, status: null })
      throw new GrowUnavailableError(op, null)
    }
    if (!response.ok) {
      console.error("grow.failed", { op, status: response.status })
      if (response.status === 401 && token) tokenCache.delete(cacheKey)
      throw new GrowUnavailableError(op, response.status)
    }
    try {
      return await response.json()
    } catch {
      console.error("grow.failed", { op, status: response.status })
      throw new GrowUnavailableError(op, response.status)
    }
  }

  async function accessToken(): Promise<string> {
    const cached = tokenCache.get(cacheKey)
    if (cached && cached.expiresAtMs - TOKEN_MARGIN_MS > now()) {
      return cached.token
    }
    const data = await post(
      "token",
      `${config.idpUrl}/idp/v1/oauth/token`,
      {
        grant_type: "client_credentials",
        client_id: config.clientId,
        client_secret: config.clientSecret,
      },
      null
    )
    const token = isRecord(data) ? data.accessToken : undefined
    const expiresAt = isRecord(data) ? data.expiresAt : undefined
    if (typeof token !== "string" || !token) {
      console.error("grow.failed", { op: "token", status: 200 })
      throw new GrowUnavailableError("token", 200)
    }
    // expiresAt is Unix seconds; without it, the documented one hour.
    const expiresAtMs =
      typeof expiresAt === "number" && Number.isFinite(expiresAt)
        ? expiresAt * 1000
        : now() + 60 * 60 * 1000
    tokenCache.set(cacheKey, { token, expiresAtMs })
    return token
  }

  async function createPaymentForm(input: PaymentFormInput): Promise<string> {
    const token = await accessToken()
    const data = await post(
      "payment_form",
      `${config.apiUrl}/payments/form`,
      {
        description: input.description,
        type: config.documentType,
        amount: agorotToProviderAmount(input.amountAgorot),
        currency: "ILS",
        vatType: 0,
        lang: "he",
        pluginId: config.pluginId,
        group: 100,
        maxPayments: 1,
        client: input.client ?? {},
        successUrl: input.successUrl,
        failureUrl: input.failureUrl,
        notifyUrl: input.notifyUrl,
        custom: input.custom,
      },
      token
    )
    const url = isRecord(data) ? data.url : undefined
    if (
      !isRecord(data) ||
      data.success === false ||
      typeof url !== "string" ||
      !url.startsWith("https://")
    ) {
      const errorCode =
        isRecord(data) && typeof data.errorCode === "number"
          ? data.errorCode
          : null
      console.error("grow.failed", { op: "payment_form", errorCode })
      throw new GrowUnavailableError("payment_form", 200)
    }
    return url
  }

  // Documents of the configured type, dated from fromDate (YYYY-MM-DD) on,
  // not cancelled, whose description holds the reference as a whole token.
  async function findCheckoutDocument(
    reference: string,
    fromDate: string
  ): Promise<DocumentSearch> {
    const token = await accessToken()
    const data = await post(
      "documents_search",
      `${config.apiUrl}/documents/search`,
      {
        description: reference,
        fromDate,
        type: [config.documentType],
        page: 1,
        pageSize: 100,
      },
      token
    )
    const items = isRecord(data) ? data.items : undefined
    if (!Array.isArray(items)) {
      console.error("grow.failed", { op: "documents_search", status: 200 })
      throw new GrowUnavailableError("documents_search", 200)
    }
    const matches = items.filter(
      (item): item is Record<string, unknown> =>
        isRecord(item) &&
        typeof item.id === "string" &&
        item.id.length > 0 &&
        item.type === config.documentType &&
        typeof item.status === "number" &&
        !CANCELLED_STATUSES.has(item.status) &&
        typeof item.documentDate === "string" &&
        item.documentDate >= fromDate &&
        descriptionHasReference(item.description, reference)
    )
    if (matches.length === 0) return { kind: "none" }
    if (matches.length > 1) return { kind: "many" }
    const doc = matches[0]
    const created =
      typeof doc.creationDate === "number" && Number.isFinite(doc.creationDate)
        ? new Date(doc.creationDate * 1000)
        : new Date(`${doc.documentDate as string}T12:00:00Z`)
    return {
      kind: "one",
      document: {
        id: doc.id as string,
        amountAgorot:
          typeof doc.amount === "number"
            ? providerAmountToAgorot(doc.amount)
            : null,
        currency: typeof doc.currency === "string" ? doc.currency : "",
        paidAt: Number.isNaN(created.getTime())
          ? new Date(now()).toISOString()
          : created.toISOString(),
      },
    }
  }

  return { createPaymentForm, findCheckoutDocument }
}

export type GrowClient = ReturnType<typeof createGrowClient>
