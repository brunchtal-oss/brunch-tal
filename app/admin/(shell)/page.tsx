import { Suspense } from "react"
import type { Metadata } from "next"
import { connection } from "next/server"

import { PageHeading } from "@/components/shared/page-heading"
import { shellCopy } from "@/lib/copy/shell"
import { adminGreeting, metadataFullName } from "@/lib/greeting"
import { createClient } from "@/lib/supabase/server"

import { AdminHomeActions } from "./home/admin-home-actions"
import { AttentionList } from "./home/attention-list"
import { ExpiringCards } from "./home/expiring-cards"
import { MonthTotals } from "./home/month-totals"
import { NextSessions } from "./home/next-sessions"
import { OpenRefunds } from "./home/open-refunds"

export const metadata: Metadata = {
  title: shellCopy.admin.homeTitle,
}

function Loading() {
  return <p className="text-muted-foreground">{shellCopy.loading}</p>
}

// The h1 greets her by the time of day in Jerusalem and her first name
// (user decision 2026-10-08). Per request (connection() before the clock,
// so the cached shell never freezes it); the fallback is "היי". An admin
// has no profiles row: her name is full_name in her Auth user metadata
// (user decision 2026-10-08; set once per environment, see README).
async function Greeting() {
  await connection()
  const supabase = await createClient()
  const { data } = await supabase.auth.getClaims()
  let name = metadataFullName(data?.claims?.user_metadata)
  // A token without user_metadata: ask Auth for the user once.
  if (name === null && data?.claims && !("user_metadata" in data.claims)) {
    const { data: user } = await supabase.auth.getUser()
    name = metadataFullName(user.user?.user_metadata)
  }
  return adminGreeting(name, new Date())
}

// The admin home (story 4.1, CAP-24; design round, user decision
// 2026-10-07, EXPERIENCE › Information Architecture), in this order: the h1
// (the greeting; the <title> stays "בית"), the two actions, a session-tile
// for the next session and one for the session after it, "לכל המפגשים",
// then a cube each for "לטיפול" (the
// three newest), the open refund requests (story 3.7, only while there is
// one), the cards about to expire and the month's sum. Cubes are
// 12px apart. Each part is a separate component in its own <Suspense>.
// Rendered inside the admin shell's <Suspense> gate.
export default function AdminHomePage() {
  return (
    <div className="flex flex-col gap-3">
      <PageHeading>
        <Suspense fallback={adminGreeting(null, null)}>
          <Greeting />
        </Suspense>
      </PageHeading>
      <AdminHomeActions />
      <Suspense fallback={<Loading />}>
        <NextSessions />
      </Suspense>
      <Suspense fallback={<Loading />}>
        <AttentionList />
      </Suspense>
      <Suspense fallback={<Loading />}>
        <OpenRefunds />
      </Suspense>
      <Suspense fallback={<Loading />}>
        <ExpiringCards />
      </Suspense>
      <Suspense fallback={<Loading />}>
        <MonthTotals />
      </Suspense>
    </div>
  )
}
