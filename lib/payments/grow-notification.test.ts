import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  handleGrowNotification,
  MAX_BODY_BYTES,
  type NotifyConfirm,
} from "./grow-notification"

const ID = "11111111-1111-4111-8111-111111111111"
const SECRET = "s".repeat(43)

function request(query: string, body: BodyInit | null = "{}"): Request {
  return new Request(`https://site.test/api/payments/grow${query}`, {
    method: "POST",
    body,
  })
}

let errors: ReturnType<typeof vi.spyOn>
beforeEach(() => {
  errors = vi.spyOn(console, "error").mockImplementation(() => {})
})
afterEach(() => errors.mockRestore())

describe("handleGrowNotification", () => {
  it("200 when confirmed; the confirm gets c and s from the query", async () => {
    const confirm = vi.fn<NotifyConfirm>().mockResolvedValue({
      ok: true,
      pending: false,
    })
    const response = await handleGrowNotification(
      request(`?c=${ID}&s=${SECRET}`, '{"transactionId":"x","cardNumber":"1"}'),
      confirm
    )
    expect(response.status).toBe(200)
    expect(response.headers.get("Cache-Control")).toBe("no-store")
    expect(confirm).toHaveBeenCalledWith(ID, SECRET)
  })

  it.each([
    ["", "no query"],
    [`?c=${ID}`, "no secret"],
    [`?c=not-a-uuid&s=${SECRET}`, "a bad id"],
    [`?c=${ID}&s=short`, "a short secret"],
  ])("401 without calling confirm: %s (%s)", async (query) => {
    const confirm = vi.fn<NotifyConfirm>()
    const response = await handleGrowNotification(request(query), confirm)
    expect(response.status).toBe(401)
    expect(confirm).not.toHaveBeenCalled()
  })

  it("401 for CHECKOUT_NOT_FOUND (a wrong secret)", async () => {
    const response = await handleGrowNotification(
      request(`?c=${ID}&s=${SECRET}`),
      async () => ({ ok: false, code: "CHECKOUT_NOT_FOUND" })
    )
    expect(response.status).toBe(401)
  })

  it.each(["GROW_UNAVAILABLE", "SERVER_ERROR"] as const)(
    "503 for %s, so Grow retries",
    async (code) => {
      const response = await handleGrowNotification(
        request(`?c=${ID}&s=${SECRET}`),
        async () => ({ ok: false, code })
      )
      expect(response.status).toBe(503)
    }
  )

  it("503 while the document is not at morning yet", async () => {
    const response = await handleGrowNotification(
      request(`?c=${ID}&s=${SECRET}`),
      async () => ({ ok: true, pending: true })
    )
    expect(response.status).toBe(503)
  })

  it("503 when confirm throws", async () => {
    const response = await handleGrowNotification(
      request(`?c=${ID}&s=${SECRET}`),
      async () => {
        throw new Error("db down")
      }
    )
    expect(response.status).toBe(503)
  })

  it("reads a large body only up to the limit, and logs nothing of it", async () => {
    const big = "x".repeat(MAX_BODY_BYTES * 3)
    const response = await handleGrowNotification(
      request(`?c=${ID}&s=${SECRET}`, big),
      async () => ({ ok: false, code: "SERVER_ERROR" })
    )
    expect(response.status).toBe(503)
    const logged = JSON.stringify(errors.mock.calls)
    expect(logged).not.toContain("xxxx")
    expect(logged).not.toContain(SECRET)
  })
})
