import { describe, expect, it, vi } from "vitest"

import {
  handleReconcile,
  RECONCILE_LIMIT,
  reconcileConfigured,
  type ReconcileDeps,
} from "./reconcile-handler"

const SECRET = "cron-secret-value"

function request(auth: string | null = `Bearer ${SECRET}`): Request {
  return new Request("https://site.test/api/jobs/reconcile-payments", {
    method: "POST",
    headers: auth ? { Authorization: auth } : {},
  })
}

function deps(extra: Partial<ReconcileDeps> = {}): ReconcileDeps {
  return {
    cronSecret: SECRET,
    configured: true,
    claim: vi.fn(async () => []),
    confirm: vi.fn(async () => ({ ok: true })),
    ...extra,
  }
}

describe("handleReconcile", () => {
  it("no CRON_SECRET: 503", async () => {
    const d = deps({ cronSecret: "" })
    expect((await handleReconcile(request(), d)).status).toBe(503)
    expect(d.claim).not.toHaveBeenCalled()
  })

  it.each([null, "Bearer wrong", "Basic x"])(
    "a missing or wrong secret (%j): 401, no call",
    async (auth) => {
      const d = deps()
      expect((await handleReconcile(request(auth), d)).status).toBe(401)
      expect(d.claim).not.toHaveBeenCalled()
    }
  )

  it("Grow vars missing: 200 at once, no claim and no confirm", async () => {
    const d = deps({ configured: false })
    const response = await handleReconcile(request(), d)
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ skipped: true })
    expect(d.claim).not.toHaveBeenCalled()
    expect(d.confirm).not.toHaveBeenCalled()
  })

  it("payments on: claims at most 20 and confirms each", async () => {
    const ids = Array.from({ length: 25 }, (_, i) => `id-${i}`)
    const confirm = vi.fn(async (id: string) => ({ ok: id !== "id-3" }))
    const claim = vi.fn(async () => ids)
    const response = await handleReconcile(request(), deps({ claim, confirm }))
    expect(claim).toHaveBeenCalledWith(RECONCILE_LIMIT)
    expect(RECONCILE_LIMIT).toBe(20)
    expect(confirm).toHaveBeenCalledTimes(20)
    expect(await response.json()).toEqual({ checked: 25, confirmed: 19 })
    expect(response.headers.get("Cache-Control")).toBe("no-store")
  })

  it("a throwing confirm does not stop the others", async () => {
    const confirm = vi
      .fn()
      .mockRejectedValueOnce(new Error("x"))
      .mockResolvedValue({ ok: true })
    const response = await handleReconcile(
      request(),
      deps({ claim: async () => ["a", "b"], confirm })
    )
    expect(await response.json()).toEqual({ checked: 2, confirmed: 1 })
  })

  it("a failed claim: 503", async () => {
    const response = await handleReconcile(
      request(),
      deps({ claim: async () => null })
    )
    expect(response.status).toBe(503)
  })
})

describe("reconcileConfigured", () => {
  const VARS = {
    GROW_ENV: "sandbox",
    GROW_CLIENT_ID: "id",
    GROW_CLIENT_SECRET: "secret",
    GROW_PLUGIN_ID: "plugin",
    GROW_DOCUMENT_TYPE: "400",
  }

  it("runs with the switch off when the Grow vars are present", () => {
    expect(
      reconcileConfigured({ ...VARS, ONLINE_PAYMENTS_ENABLED: "false" })
    ).toBe(true)
  })

  it("stops when a Grow var is missing, even with the switch on", () => {
    expect(
      reconcileConfigured({
        ...VARS,
        ONLINE_PAYMENTS_ENABLED: "true",
        GROW_CLIENT_ID: "",
      })
    ).toBe(false)
  })
})
