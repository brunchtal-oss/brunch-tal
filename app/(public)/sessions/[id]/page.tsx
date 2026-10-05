import { Suspense } from "react"
import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { connection } from "next/server"

import {
  PublicSessionAction,
  PublicSessionView,
} from "@/components/public/public-sessions"
import { getViewerRole } from "@/lib/auth/viewer-role"
import {
  getBusinessDetails,
  guestWhatsappHref,
} from "@/lib/content/business-details"
import { shellCopy } from "@/lib/copy/shell"
import { getPublicSession } from "@/lib/sessions/public"

// Like /me/sessions/[id]: the list's name, no query in the metadata.
export const metadata: Metadata = { title: shellCopy.nav.publicSessions }

// One public session (story 5.16, CAP-1, CAP-12): the concept-header, the
// display price when Tal set one, the action (a signed-in customer:
// "להרשמה" to the session in her area; anyone else: contact or log in) and
// the description. Only a published session that has not started; anything
// else is notFound(). Dynamic (AD-2), inside <Suspense>; a read error goes
// to the error boundary.
export default function PublicSessionPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  return (
    <Suspense
      fallback={
        <p className="mx-auto w-full max-w-[720px] px-6 pt-8 text-center text-muted-foreground">
          {shellCopy.loading}
        </p>
      }
    >
      <SessionContent params={params} />
    </Suspense>
  )
}

async function SessionContent({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  await connection()
  const [session, role, details] = await Promise.all([
    getPublicSession(id),
    getViewerRole(),
    getBusinessDetails(),
  ])
  if (!session) notFound()

  return (
    <div className="pb-12">
      <PublicSessionView
        session={session}
        action={
          <PublicSessionAction
            sessionId={session.id}
            customer={role === "customer"}
            whatsappHref={guestWhatsappHref(details)}
          />
        }
      />
    </div>
  )
}
