import { useId } from "react"
import Link from "next/link"
import { connection } from "next/server"

import { shellCopy } from "@/lib/copy/shell"
import { SESSIONS_HREF } from "@/lib/nav"
import {
  listUpcomingPublicSessions,
  type PublicSession,
} from "@/lib/sessions/public"

import { PublicSessionCard } from "./public-sessions"
import { PublicSection, SectionHeading } from "./sections"

const copy = shellCopy.public.sessions

// How many sessions the home page shows (story 5.16).
export const HOME_SESSIONS = 3

// The home page's upcoming sessions (story 5.16, after the intro): dynamic
// (AD-2), so the page renders it inside <Suspense> and the rest of the home
// page stays cached. Without sessions, or when the read fails (logged), the
// area is not there and the rest of the home page is shown.
export async function UpcomingSessions() {
  await connection()
  let sessions: PublicSession[]
  try {
    sessions = await listUpcomingPublicSessions(HOME_SESSIONS)
  } catch {
    console.error("sessions.home_read_failed")
    return null
  }
  return <UpcomingSessionsSection sessions={sessions} />
}

export function UpcomingSessionsSection({
  sessions,
}: {
  sessions: PublicSession[]
}) {
  const id = useId()
  if (sessions.length === 0) return null
  return (
    <PublicSection titleId={id}>
      <SectionHeading id={id} title={copy.upcoming} />
      <ul className="mt-8 flex flex-col gap-6">
        {sessions.map((session) => (
          <li key={session.id}>
            <PublicSessionCard
              session={session}
              headingLevel={3}
              layout="horizontal"
            />
          </li>
        ))}
      </ul>
      <div className="mt-4 flex justify-center">
        <Link
          href={SESSIONS_HREF}
          className="inline-flex min-h-11 items-center rounded-[2px] text-base font-semibold underline underline-offset-[3px]"
        >
          {copy.all}
        </Link>
      </div>
    </PublicSection>
  )
}
