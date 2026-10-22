// The "product" field of the approval form (story 2.6): every active product,
// a hidden one (active = false) is not offered. A pinned product
// (validity_mode 'session', story 3.11) carries the rules of its session
// field. Pure: rows in, options out; the approval refuses a hidden product
// again (PRODUCT_NOT_AVAILABLE).

import type { ProductOption } from "./payment-form"

export type ProductRow = {
  id: string
  name: string
  price_agorot: number
  validity_mode: string
  eligible_event_kind: string | null
  allowed_weekdays: number[] | null
  party_size: number
  active: boolean
}

export function toProductOptions(rows: readonly ProductRow[]): ProductOption[] {
  return rows
    .filter((p) => p.active)
    .map((p) => ({
      id: p.id,
      name: p.name,
      priceAgorot: p.price_agorot,
      pinned:
        p.validity_mode === "session"
          ? {
              productId: p.id,
              eventKind:
                p.eligible_event_kind === "couple" ? "couple" : "regular",
              weekdays: p.allowed_weekdays ?? null,
              partySize: p.party_size,
            }
          : null,
    }))
}
