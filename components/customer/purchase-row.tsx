import Link from "next/link"
import { ChevronLeftIcon } from "lucide-react"

import { customerCopy } from "@/lib/copy/customer"
import { formatAgorot } from "@/lib/money"
import { formatDayMonth, formatLocalDate } from "@/lib/time"

// One purchase in the purchase history (story 4.12, user decision
// 2026-10-06): the name (a pinned purchase: "בראנץ׳ {concept}"), and under
// it one line of three: the price, "נרכשה DD.MM", and "בתוקף עד DD.MM", or
// the word of an ended one (נוצלה / פגה / בוטלה) in its place. No type
// marker. expiredNote: a card that expired before it was bound (story 2.4)
// shows its note in that place, above the link's overlay so its button
// still works. A single target: the name is the one link, whose ::after
// covers the row, to the purchase's detail; the chevron is decorative. All
// values from get_my_entitlements.
export function PurchaseRow({
  href,
  productName,
  amountAgorot,
  paidOn,
  expiresOn,
  status,
  expiredNote = null,
}: {
  href: string
  productName: string
  amountAgorot: number
  paidOn: string
  expiresOn: string
  status: string | null
  expiredNote?: React.ReactNode
}) {
  return (
    <div className="relative flex flex-col gap-1 py-4 pe-8">
      <Link
        href={href}
        className="self-start rounded-[4px] text-[17px] font-semibold after:absolute after:inset-0 after:content-['']"
      >
        <bdi>{productName}</bdi>
      </Link>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[15px] text-muted-foreground">
        <bdi className="text-foreground">{formatAgorot(amountAgorot)}</bdi>
        <span>
          {customerCopy.purchasedOn}{" "}
          <time dateTime={paidOn}>
            <bdi>{formatDayMonth(paidOn)}</bdi>
          </time>
        </span>
        {expiredNote ? (
          <div className="relative z-10">{expiredNote}</div>
        ) : status ? (
          <span>{status}</span>
        ) : (
          <span>
            {customerCopy.validUntil}{" "}
            <time dateTime={formatLocalDate(expiresOn)}>
              <bdi>{formatDayMonth(expiresOn)}</bdi>
            </time>
          </span>
        )}
      </div>
      <ChevronLeftIcon
        aria-hidden
        strokeWidth={1.5}
        className="absolute end-1 top-1/2 size-5 -translate-y-1/2 text-muted-foreground"
      />
    </div>
  )
}
