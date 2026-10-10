"use server"

import type { ActionResult } from "@/lib/errors"
import { isPlainObject } from "@/lib/form-values"
import { callRpc } from "@/lib/rpc"
import { createClient } from "@/lib/supabase/server"

// The product catalog (story 2.6). Every RPC runs with the admin's own
// session (private.is_admin() inside, AD-4) and checks every value again;
// these actions only check the shape. The idempotency key comes from the
// screen (one per form load or per change, AD-5).

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MAX_REASON = 500
// The generated Args type marks every parameter as non-null; an empty
// reason is sent as null.
const NONE = null as unknown as string

export async function createProductAction(input: {
  product: Record<string, unknown>
  idempotencyKey: string
}): Promise<ActionResult<{ productId: string }>> {
  if (!isPlainObject(input.product) || !UUID.test(input.idempotencyKey)) {
    return { ok: false, code: "INVALID_INPUT" }
  }
  const result = await callRpc(await createClient(), "admin_create_product", {
    p_product: input.product,
    p_idempotency_key: input.idempotencyKey,
  })
  if (!result.ok) return result
  const created = result.data as { product_id: string }
  return { ok: true, data: { productId: created.product_id } }
}

// Any field but the price, including active (hide / show).
export async function updateProductAction(input: {
  productId: string
  changes: Record<string, unknown>
  idempotencyKey: string
}): Promise<ActionResult> {
  if (
    !UUID.test(input.productId) ||
    !isPlainObject(input.changes) ||
    "price_agorot" in input.changes ||
    !UUID.test(input.idempotencyKey)
  ) {
    return { ok: false, code: "INVALID_INPUT" }
  }
  const result = await callRpc(await createClient(), "admin_update_product", {
    p_product_id: input.productId,
    p_changes: input.changes,
    p_idempotency_key: input.idempotencyKey,
  })
  if (!result.ok) return result
  return { ok: true, data: undefined }
}

export type PricePlan = {
  name: string
  oldPriceAgorot: number
  newPriceAgorot: number
}

function validPrice(price: unknown): price is number {
  return Number.isSafeInteger(price) && (price as number) >= 0
}

// What the sensitive dialog shows (AD-7): the same plan the change runs.
export async function previewProductPriceAction(input: {
  productId: string
  priceAgorot: number
}): Promise<ActionResult<PricePlan>> {
  if (!UUID.test(input.productId) || !validPrice(input.priceAgorot)) {
    return { ok: false, code: "INVALID_INPUT" }
  }
  const result = await callRpc(
    await createClient(),
    "preview_admin_set_product_price",
    { p_product_id: input.productId, p_price_agorot: input.priceAgorot }
  )
  if (!result.ok) return result
  const plan = result.data as {
    name: string
    old_price_agorot: number
    new_price_agorot: number
  }
  return {
    ok: true,
    data: {
      name: plan.name,
      oldPriceAgorot: plan.old_price_agorot,
      newPriceAgorot: plan.new_price_agorot,
    },
  }
}

// The confirmed price change (the dialog's checkbox, CONFIRM_REQUIRED
// without it).
export async function setProductPriceAction(input: {
  productId: string
  priceAgorot: number
  reason: string
  confirmed: boolean
  idempotencyKey: string
}): Promise<ActionResult> {
  const reason = typeof input.reason === "string" ? input.reason.trim() : ""
  if (
    !UUID.test(input.productId) ||
    !validPrice(input.priceAgorot) ||
    reason.length > MAX_REASON ||
    !UUID.test(input.idempotencyKey)
  ) {
    return { ok: false, code: "INVALID_INPUT" }
  }
  const result = await callRpc(
    await createClient(),
    "admin_set_product_price",
    {
      p_product_id: input.productId,
      p_price_agorot: input.priceAgorot,
      p_reason: reason || NONE,
      p_confirmed: input.confirmed === true,
      p_idempotency_key: input.idempotencyKey,
    }
  )
  if (!result.ok) return result
  return { ok: true, data: undefined }
}
