import { Suspense } from "react"
import type { Metadata } from "next"

import { PageHeading } from "@/components/shared/page-heading"
import { customerCopy } from "@/lib/copy/customer"
import { shellCopy } from "@/lib/copy/shell"

import { Bookings } from "./bookings-list"

export const metadata: Metadata = {
  title: customerCopy.bookingsTitle,
}

// Her bookings (story 3.6), opened from "לכל ההרשמות שלי" on home (no tab
// in the bottom bar, user decision 2026-10-06). First a business cancel
// waiting for her refund-or-credit choice (story 3.8), then her credits she can
// still book with (story 3.7: "זיכוי מהמפגש ב-{date}" and its options, each
// a session-card to its page, or the waiting line; an exhausted credit with
// "צרי קשר") and her open refund requests (from get_my_credits, which refreshes the options first). Then
// the upcoming ones, each a
// session-card (the cancel is only on the session page, user decision
// 2026-10-06); then the past ones (cancelled / took place). Empty: a link to the schedule. Every value comes
// from get_my_bookings. Rendered inside the layout's customer gate.
export default function BookingsPage() {
  return (
    <>
      <PageHeading>{customerCopy.bookingsTitle}</PageHeading>
      <Suspense
        fallback={<p className="text-muted-foreground">{shellCopy.loading}</p>}
      >
        <Bookings />
      </Suspense>
    </>
  )
}
