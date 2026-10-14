import Link from "next/link"

import { StatusChip } from "@/components/shared/status-chip"
import { adminCopy } from "@/lib/copy/admin"
import { callRpc } from "@/lib/rpc"
import { createClient } from "@/lib/supabase/server"
import { cn } from "@/lib/utils"

import { RefundComplete } from "./refund-complete"
import { parseRefundRows, toRefundItem, type RefundItem } from "./refund-items"

const copy = adminCopy.refunds

// "בקשות החזר" on /admin/payments (story 3.9, user decisions 2026-10-13
// and 2026-10-14): one cube (DESIGN › card) with the open requests only,
// oldest first, each with "סימון שההחזר בוצע". Without an open request the
// section is not shown at all; a completed refund stays in the customer's
// card. Each row's id is refund-<id>, the target of the home and "לטיפול";
// the row reached by that link is tinted (:target) so it is found at once.
// The "ההחזר נרשם" notice lives in the page's ResultNoticeHost, so it stays
// after the last open request leaves.
export async function RefundsSection() {
  const result = await callRpc(
    await createClient(),
    "admin_list_refund_requests"
  )
  if (!result.ok) throw new Error("admin_list_refund_requests failed")
  const open = parseRefundRows(result.data)
    .map(toRefundItem)
    .filter((i) => i.open)
  if (open.length === 0) return null

  return (
    <section
      aria-labelledby="refunds-title"
      className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <h2
          id="refunds-title"
          className="text-base leading-[1.35] font-semibold"
        >
          {copy.title}
        </h2>
        <StatusChip tone="pending">
          {copy.chipOpen} ({open.length})
        </StatusChip>
      </div>
      <ul className="flex flex-col">
        {open.map((item) => (
          <RefundRowView key={item.id} item={item} />
        ))}
      </ul>
    </section>
  )
}

function RefundRowView({ item }: { item: RefundItem }) {
  return (
    <li
      id={item.anchor}
      className={cn(
        "-mx-2 flex scroll-mt-24 flex-col gap-1 rounded-lg border-t border-border px-2 py-3 first:border-t-0",
        "target:bg-muted"
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <p className="text-base leading-[1.35] font-semibold">
          {item.customerHref ? (
            <Link
              href={item.customerHref}
              className="rounded-[4px] underline underline-offset-[3px]"
            >
              <bdi className="break-words">{item.title}</bdi>
            </Link>
          ) : (
            <bdi className="break-words">{item.title}</bdi>
          )}
        </p>
      </div>
      <p className="text-[15px]">
        <bdi>{item.detail}</bdi>
      </p>
      {item.reference && (
        <p className="text-[13px] text-muted-foreground">
          <bdi>{item.reference}</bdi>
        </p>
      )}
      <div className="pt-1">
        <RefundComplete
          refundRequestId={item.id}
          name={item.name}
          pendingJoin={item.customerHref === null}
        />
      </div>
    </li>
  )
}
