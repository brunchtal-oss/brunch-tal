import { beforeEach, describe, expect, it, vi } from "vitest"

const purchaseOptions = vi.fn()
const startPurchase = vi.fn()

vi.mock("@/lib/server/privileged/checkout", () => ({
  purchaseOptions: (...args: unknown[]) => purchaseOptions(...args),
  startPurchase: (...args: unknown[]) => startPurchase(...args),
}))

const { loadCardPurchaseOptions, startCardPurchaseAction } =
  await import("./actions")
const { loadSessionPurchaseOptions, startSessionPurchaseAction } =
  await import("../sessions/[id]/actions")
const { loadGuestPurchaseOptions, startGuestPurchaseAction } =
  await import("../../(public)/sessions/[id]/actions")

const PRODUCT = "22222222-2222-4222-8222-222222222222"
const EVENT = "33333333-3333-4333-8333-333333333333"
const KEY = "44444444-4444-4444-8444-444444444444"
const INPUT = {
  productId: PRODUCT,
  eventId: null,
  termsAccepted: true,
  idempotencyKey: KEY,
}

beforeEach(() => {
  purchaseOptions.mockReset()
  startPurchase.mockReset()
  purchaseOptions.mockResolvedValue({ enabled: false, products: [] })
  startPurchase.mockResolvedValue({ ok: false, code: "ONLINE_PAYMENTS_OFF" })
})

describe("the purchase actions (online payments, PR B)", () => {
  it("the loaders: a customer's session, her cards, a guest's session", async () => {
    await loadSessionPurchaseOptions(EVENT)
    expect(purchaseOptions).toHaveBeenLastCalledWith("customer", EVENT)
    await loadCardPurchaseOptions()
    expect(purchaseOptions).toHaveBeenLastCalledWith("customer", null)
    await loadGuestPurchaseOptions(EVENT)
    expect(purchaseOptions).toHaveBeenLastCalledWith("guest", EVENT)
  })

  it("a loader never takes a uid from its input", async () => {
    await loadSessionPurchaseOptions({ uid: "x" } as unknown as string)
    expect(purchaseOptions).toHaveBeenLastCalledWith("customer", "x")
  })

  it("a customer's start and a guest's start keep who they are", async () => {
    await startSessionPurchaseAction({ ...INPUT, eventId: EVENT })
    expect(startPurchase).toHaveBeenLastCalledWith({
      as: "customer",
      ...INPUT,
      eventId: EVENT,
    })
    const payer = { name: "Noa", email: "noa@example.test" }
    await startGuestPurchaseAction({ ...INPUT, as: "customer", payer })
    expect(startPurchase).toHaveBeenLastCalledWith({
      as: "guest",
      ...INPUT,
      payer,
    })
  })

  it("a card is always bought without a session", async () => {
    await expect(
      startCardPurchaseAction({ ...INPUT, eventId: EVENT })
    ).resolves.toEqual({ ok: false, code: "INVALID_INPUT" })
    await startCardPurchaseAction(INPUT)
    expect(startPurchase).toHaveBeenCalledTimes(1)
    expect(startPurchase).toHaveBeenLastCalledWith({ as: "customer", ...INPUT })
  })

  it("a bad shape is INVALID_INPUT without a start", async () => {
    for (const start of [
      startCardPurchaseAction,
      startSessionPurchaseAction,
      startGuestPurchaseAction,
    ]) {
      await expect(start({ ...INPUT, productId: "x" })).resolves.toEqual({
        ok: false,
        code: "INVALID_INPUT",
      })
    }
    expect(startPurchase).not.toHaveBeenCalled()
  })

  it("a guest without her name and email: INVALID_INPUT without a start", async () => {
    await expect(startGuestPurchaseAction(INPUT)).resolves.toEqual({
      ok: false,
      code: "INVALID_INPUT",
    })
    await expect(
      startGuestPurchaseAction({ ...INPUT, payer: { name: "Noa", email: "x" } })
    ).resolves.toEqual({ ok: false, code: "INVALID_INPUT" })
    expect(startPurchase).not.toHaveBeenCalled()
  })
})
