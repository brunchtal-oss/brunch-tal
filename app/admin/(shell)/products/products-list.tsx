import Link from "next/link"
import { ChevronLeftIcon } from "lucide-react"

import { adminCopy } from "@/lib/copy/admin"

import { productSummary, type ProductRow } from "./product-draft"

const copy = adminCopy.products

// The rows of the catalog: name, "מוסתר" (status-chip, expired) for a
// hidden product, and the summary "{price} · {N} כניסות · {validity}".
export function ProductsList({ rows }: { rows: readonly ProductRow[] }) {
  return (
    <ul className="flex flex-col border-t border-border">
      {rows.map((row) => (
        <li key={row.id} className="border-b border-border">
          <Link
            href={`/admin/products/${row.id}`}
            className="flex min-h-14 items-center justify-between gap-3 py-3"
          >
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className="flex flex-wrap items-center gap-2">
                <span className="text-base font-semibold break-words">
                  <bdi>{row.name}</bdi>
                </span>
                {!row.active && (
                  <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-expired-tint px-2.5 py-0.5 text-[13px] font-semibold text-expired">
                    <span
                      aria-hidden
                      className="size-[7px] rounded-full bg-expired-dot"
                    />
                    {copy.hidden}
                  </span>
                )}
              </span>
              <span className="text-[13px] text-muted-foreground">
                <bdi>{productSummary(row)}</bdi>
              </span>
            </span>
            <ChevronLeftIcon
              aria-hidden
              strokeWidth={1.5}
              className="size-5 shrink-0 text-muted-foreground"
            />
          </Link>
        </li>
      ))}
    </ul>
  )
}
