import { Suspense } from "react"
import type { Metadata } from "next"
import { connection } from "next/server"

import { BookedChip } from "@/components/public/booked-chip"
import { PublicPageHeading } from "@/components/public/public-page"
import { PublicSessionList } from "@/components/public/public-sessions"
import {
  getBusinessDetails,
  guestWhatsappHref,
} from "@/lib/content/business-details"
import { shellCopy } from "@/lib/copy/shell"
import { listUpcomingPublicSessions } from "@/lib/sessions/public"

const title = shellCopy.nav.publicSessions

export const metadata: Metadata = { title }

// /sessions (story 5.16, CAP-1): every published session that has not
// started, by date, as a session-card linking to /sessions/[id]. Nothing
// about places and no type label; a signed-in customer sees "נרשמת" on her
// own sessions (story 5.21). Dynamic (AD-2): the list is read with the
// anon client inside <Suspense> after connection(); the heading is static. A
// read error goes to the error boundary.
export default function PublicSessionsPage() {
  return (
    <div className="pb-12">
      <PublicPageHeading>{title}</PublicPageHeading>
      <Suspense
        fallback={
          <p className="mx-auto w-full max-w-[720px] px-6 pt-8 text-center text-muted-foreground">
            {shellCopy.loading}
          </p>
        }
      >
        <SessionsList />
      </Suspense>
    </div>
  )
}

async function SessionsList() {
  await connection()
  const [sessions, details] = await Promise.all([
    listUpcomingPublicSessions(),
    getBusinessDetails(),
  ])
  const eventIds = sessions.map((s) => s.id).join(",")
  // Story 5.21: "נרשמת" per row, each in its own <Suspense>, so the list
  // shows at once and never waits on the session.
  return (
    <PublicSessionList
      sessions={sessions}
      whatsappHref={guestWhatsappHref(details)}
      statusOf={(id) => (
        <Suspense fallback={null}>
          <BookedChip eventId={id} eventIds={eventIds} />
        </Suspense>
      )}
    />
  )
}
