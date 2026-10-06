import { Suspense } from "react"
import type { Metadata } from "next"

import { PageHeading } from "@/components/shared/page-heading"
import { shellCopy } from "@/lib/copy/shell"

import { AttentionList } from "./home/attention-list"
import { ExpiringCards } from "./home/expiring-cards"
import { MonthTotals } from "./home/month-totals"
import { NextSessions } from "./home/next-sessions"

export const metadata: Metadata = {
  title: shellCopy.admin.homeTitle,
}

function Loading() {
  return <p className="text-muted-foreground">{shellCopy.loading}</p>
}

// The admin home (story 4.1, CAP-24; mockup key-admin-home): the next
// session and the ones after it, "לטיפול" (the three newest), the cards
// about to expire, and the month's sum (after the phone check, 2026-10-06). Each part is a separate component in
// its own <Suspense>. Rendered inside the admin shell's <Suspense> gate.
export default function AdminHomePage() {
  return (
    <>
      <PageHeading>{shellCopy.admin.homeTitle}</PageHeading>
      <Suspense fallback={<Loading />}>
        <NextSessions />
      </Suspense>
      <Suspense fallback={<Loading />}>
        <AttentionList />
      </Suspense>
      <Suspense fallback={<Loading />}>
        <ExpiringCards />
      </Suspense>
      <Suspense fallback={<Loading />}>
        <MonthTotals />
      </Suspense>
    </>
  )
}
