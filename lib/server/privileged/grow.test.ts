import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  clearGrowTokenCache,
  createGrowClient,
  descriptionHasReference,
  GrowUnavailableError,
} from "./grow"
import type { GrowConfig } from "@/lib/payments/online-config"

const CONFIG: GrowConfig = {
  env: "sandbox",
  idpUrl: "https://idp.test",
  apiUrl: "https://api.test/api/v1",
  clientId: "client-id",
  clientSecret: "client-secret-value",
  pluginId: "plugin-id",
  documentType: 400,
}

const NOW = Date.UTC(2026, 10, 20, 10, 0, 0)

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}

const TOKEN = { accessToken: "jwt-token", expiresAt: NOW / 1000 + 3600 }

function doc(extra: Record<string, unknown>) {
  return {
    id: "doc-1",
    type: 400,
    status: 1,
    documentDate: "2026-11-20",
    creationDate: NOW / 1000,
    description: "BT-AB12000000 · כרטיסייה",
    amount: 472,
    currency: "ILS",
    ...extra,
  }
}

let fetchMock: ReturnType<typeof vi.fn>
let now: number
let errors: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  clearGrowTokenCache()
  fetchMock = vi.fn()
  now = NOW
  errors = vi.spyOn(console, "error").mockImplementation(() => {})
})

afterEach(() => {
  errors.mockRestore()
})

function client() {
  return createGrowClient(CONFIG, {
    fetch: fetchMock as unknown as typeof fetch,
    now: () => now,
  })
}

function bodyOf(call: number): Record<string, unknown> {
  return JSON.parse(fetchMock.mock.calls[call][1].body as string)
}

describe("createPaymentForm", () => {
  it("gets a token, then posts the form with the fixed fields", async () => {
    fetchMock
      .mockResolvedValueOnce(json(TOKEN))
      .mockResolvedValueOnce(json({ url: "https://pay.test/form/1" }))

    const url = await client().createPaymentForm({
      description: "BT-AB12000000 · כרטיסייה",
      amountAgorot: 12750,
      successUrl: "https://site.test/pay/return",
      failureUrl: "https://site.test/pay/failed",
      notifyUrl: "https://site.test/api/payments/grow?c=1&s=2",
      custom: "checkout-1",
    })

    expect(url).toBe("https://pay.test/form/1")
    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://idp.test/idp/v1/oauth/token"
    )
    expect(bodyOf(0)).toEqual({
      grant_type: "client_credentials",
      client_id: "client-id",
      client_secret: "client-secret-value",
    })
    expect(fetchMock.mock.calls[1][0]).toBe(
      "https://api.test/api/v1/payments/form"
    )
    expect(fetchMock.mock.calls[1][1].headers.Authorization).toBe(
      "Bearer jwt-token"
    )
    expect(fetchMock.mock.calls[1][1].signal).toBeInstanceOf(AbortSignal)
    expect(bodyOf(1)).toEqual({
      description: "BT-AB12000000 · כרטיסייה",
      type: 400,
      amount: 127.5,
      currency: "ILS",
      vatType: 0,
      lang: "he",
      pluginId: "plugin-id",
      group: 100,
      maxPayments: 1,
      client: {},
      successUrl: "https://site.test/pay/return",
      failureUrl: "https://site.test/pay/failed",
      notifyUrl: "https://site.test/api/payments/grow?c=1&s=2",
      custom: "checkout-1",
    })
  })

  it("caches the token until 60 seconds before it expires", async () => {
    fetchMock.mockImplementation(async (url: string) =>
      url.endsWith("/oauth/token")
        ? json(TOKEN)
        : json({ url: "https://pay.test/form" })
    )
    const input = {
      description: "BT-AB12000000 · x",
      amountAgorot: 100,
      successUrl: "https://s/r",
      failureUrl: "https://s/f",
      notifyUrl: "https://s/n",
      custom: "c",
    }
    const grow = client()
    await grow.createPaymentForm(input)
    now = NOW + 58 * 60 * 1000
    await grow.createPaymentForm(input)
    const tokenCalls = () =>
      fetchMock.mock.calls.filter(([url]) =>
        String(url).endsWith("/oauth/token")
      ).length
    expect(tokenCalls()).toBe(1)
    now = NOW + 59 * 60 * 1000 + 1
    await grow.createPaymentForm(input)
    expect(tokenCalls()).toBe(2)
  })

  it("a failed answer is GrowUnavailableError, and nothing secret is logged", async () => {
    fetchMock
      .mockResolvedValueOnce(json(TOKEN))
      .mockResolvedValueOnce(json({ success: false, errorCode: 2403 }))
    await expect(
      client().createPaymentForm({
        description: "d",
        amountAgorot: 100,
        successUrl: "https://s/r",
        failureUrl: "https://s/f",
        notifyUrl: "https://s/n?s=secret-in-url",
        custom: "c",
      })
    ).rejects.toBeInstanceOf(GrowUnavailableError)
    const logged = JSON.stringify(errors.mock.calls)
    expect(logged).not.toContain("secret")
    expect(logged).not.toContain("jwt-token")
  })

  it("a network failure or a 5xx is GrowUnavailableError", async () => {
    fetchMock.mockRejectedValueOnce(new Error("timeout"))
    await expect(
      client().findCheckoutDocument("BT-AB12000000", "2026-11-20")
    ).rejects.toBeInstanceOf(GrowUnavailableError)

    fetchMock
      .mockResolvedValueOnce(json(TOKEN))
      .mockResolvedValueOnce(json({ error: "x" }, 503))
    await expect(
      client().findCheckoutDocument("BT-AB12000000", "2026-11-20")
    ).rejects.toBeInstanceOf(GrowUnavailableError)
  })
})

describe("findCheckoutDocument", () => {
  async function search(items: unknown[]) {
    fetchMock
      .mockResolvedValueOnce(json(TOKEN))
      .mockResolvedValueOnce(
        json({ total: items.length, page: 1, pageSize: 100, items })
      )
    return client().findCheckoutDocument("BT-AB12000000", "2026-11-20")
  }

  it("searches by the reference, the date and the type", async () => {
    await search([])
    expect(fetchMock.mock.calls[1][0]).toBe(
      "https://api.test/api/v1/documents/search"
    )
    expect(bodyOf(1)).toEqual({
      description: "BT-AB12000000",
      fromDate: "2026-11-20",
      type: [400],
      page: 1,
      pageSize: 100,
    })
  })

  it("none", async () => {
    expect(await search([])).toEqual({ kind: "none" })
  })

  it("one: the id, the amount in agorot, the currency, the creation time", async () => {
    expect(await search([doc({ amount: 0.1 + 0.2 })])).toEqual({
      kind: "one",
      document: {
        id: "doc-1",
        amountAgorot: 30,
        currency: "ILS",
        paidAt: new Date(NOW).toISOString(),
      },
    })
  })

  it("many", async () => {
    expect(await search([doc({}), doc({ id: "doc-2" })])).toEqual({
      kind: "many",
    })
  })

  it("keeps only the exact reference, the type, the date and not cancelled", async () => {
    const result = await search([
      doc({ id: "near", description: "BT-AB120000001 · x" }),
      doc({ id: "other-type", type: 320 }),
      doc({ id: "cancelled", status: 4 }),
      doc({ id: "cancelling", status: 3 }),
      doc({ id: "old", documentDate: "2026-11-19" }),
      doc({ id: "match" }),
    ])
    expect(result.kind).toBe("one")
    expect(result.kind === "one" && result.document.id).toBe("match")
  })
})

describe("descriptionHasReference", () => {
  it.each([
    ["כרטיסייה · BT-AB12", "BT-AB12", true],
    ["כרטיסייה · BT-AB123", "BT-AB12", false],
    ["כרטיסייה · XBT-AB12", "BT-AB12", false],
    ["BT-AB12", "BT-AB12", true],
    [null, "BT-AB12", false],
  ])("%j has %s: %s", (description, reference, expected) => {
    expect(descriptionHasReference(description, reference)).toBe(expected)
  })
})

describe("paging and the token on 401", () => {
  it("pages through the results (pages from the answer) and finds the document on page 2", async () => {
    fetchMock
      .mockResolvedValueOnce(json(TOKEN))
      .mockResolvedValueOnce(
        json({ total: 150, page: 1, pageSize: 100, pages: 2, items: [] })
      )
      .mockResolvedValueOnce(
        json({ total: 150, page: 2, pageSize: 100, pages: 2, items: [doc({})] })
      )
    const result = await client().findCheckoutDocument(
      "BT-AB12000000",
      "2026-11-20"
    )
    expect(result.kind).toBe("one")
    expect(bodyOf(1).page).toBe(1)
    expect(bodyOf(2).page).toBe(2)
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it("the page count from total when pages is missing", async () => {
    fetchMock
      .mockResolvedValueOnce(json(TOKEN))
      .mockResolvedValueOnce(json({ total: 101, items: [] }))
      .mockResolvedValueOnce(json({ total: 101, items: [] }))
    expect(
      await client().findCheckoutDocument("BT-AB12000000", "2026-11-20")
    ).toEqual({ kind: "none" })
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it("more than 5 pages is unavailable, not none", async () => {
    fetchMock
      .mockResolvedValueOnce(json(TOKEN))
      .mockResolvedValueOnce(json({ total: 600, pages: 6, items: [] }))
    await expect(
      client().findCheckoutDocument("BT-AB12000000", "2026-11-20")
    ).rejects.toBeInstanceOf(GrowUnavailableError)
  })

  it("a 401 drops the cached token, so the next call gets a new one", async () => {
    fetchMock
      .mockResolvedValueOnce(json(TOKEN))
      .mockResolvedValueOnce(json({ error: "x" }, 401))
      .mockResolvedValueOnce(json({ ...TOKEN, accessToken: "jwt-new" }))
      .mockResolvedValueOnce(json({ total: 0, items: [] }))
    const grow = client()
    await expect(
      grow.findCheckoutDocument("BT-AB12000000", "2026-11-20")
    ).rejects.toBeInstanceOf(GrowUnavailableError)
    await grow.findCheckoutDocument("BT-AB12000000", "2026-11-20")
    expect(String(fetchMock.mock.calls[2][0])).toMatch(/oauth\/token$/)
    expect(fetchMock.mock.calls[3][1].headers.Authorization).toBe(
      "Bearer jwt-new"
    )
  })
})
