import Link from "next/link"

import { buttonClass } from "@/components/shared/button-class"
import { adminCopy } from "@/lib/copy/admin"

// DESIGN.md › admin-home-actions (design round, user decision 2026-10-07):
// under the h1 "בית", two equal columns 8px apart: "הוספת תשלום" as
// button-primary and "בראנץ׳ חדש" as button-secondary, 48px high, 4px corners.
export function AdminHomeActions() {
  return (
    <div className="grid grid-cols-2 gap-2">
      <Link
        href="/admin/payments/new"
        className={buttonClass({
          className:
            "h-auto min-h-12 rounded-lg px-4 text-base leading-[1.2] font-semibold whitespace-normal",
        })}
      >
        {adminCopy.paymentsList.add}
      </Link>
      <Link
        href="/admin/sessions/new"
        className={buttonClass({
          variant: "outline",
          className:
            "h-auto min-h-12 rounded-lg border border-foreground bg-transparent px-4 text-base leading-[1.2] font-semibold whitespace-normal text-foreground",
        })}
      >
        {adminCopy.sessions.addBrunch}
      </Link>
    </div>
  )
}
