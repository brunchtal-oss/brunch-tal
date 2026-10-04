import type { ProductRow } from "./product-draft"

// The columns the product screens read (public.products, admin RLS).
export const PRODUCT_COLUMNS =
  "id, name, type, price_agorot, units, validity_mode, validity_days, allowed_weekdays, eligible_event_kind, party_size, intro_only, post_join_message, post_join_button_label, active"

// The generated row types its checked text columns as string; the table's
// checks guarantee the narrower values.
export function toProductRow(row: {
  id: string
  name: string
  type: string
  price_agorot: number
  units: number
  validity_mode: string
  validity_days: number | null
  allowed_weekdays: number[] | null
  eligible_event_kind: string
  party_size: number
  intro_only: boolean
  post_join_message: string | null
  post_join_button_label: string | null
  active: boolean
}): ProductRow {
  return row as ProductRow
}
