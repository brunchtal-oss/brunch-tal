import { Suspense } from "react"
import type { Metadata } from "next"
import Link from "next/link"
import { ChevronLeftIcon } from "lucide-react"

import { PageHeading } from "@/components/shared/page-heading"
import { adminCopy } from "@/lib/copy/admin"
import { shellCopy } from "@/lib/copy/shell"
import { formatLocalDate } from "@/lib/time"

import { loadHome } from "../home/load-home"
import { dayText, sessionTitle } from "../sessions/session-draft"

const copy = adminCopy.work

export const metadata: Metadata = {
  title: copy.tabTitle,
}

// The work tab (story 4.9, CAP-38; user decision 2026-10-05): the next three
// published sessions that have not ended, the first three of admin_get_home's
// upcoming_sessions, each a link to its work sheet. Dynamic, inside the admin
// shell's <Suspense> gate.
export default function WorkTabPage() {
  return (
    <>
      <div className="flex flex-col gap-1">
        <PageHeading>{copy.tabTitle}</PageHeading>
        <p className="text-base text-muted-foreground">{copy.tabIntro}</p>
      </div>
      <Suspense
        fallback={<p className="text-muted-foreground">{shellCopy.loading}</p>}
      >
        <WorkSessions />
      </Suspense>
    </>
  )
}

async function WorkSessions() {
  const { upcoming_sessions: sessions } = await loadHome()
  const next = sessions.slice(0, 3)

  if (next.length === 0) {
    return (
      <div className="flex flex-col items-start gap-3">
        <p className="text-base text-muted-foreground">{copy.noSessions}</p>
        <Link
          href="/admin/sessions"
          className="inline-flex min-h-11 items-center text-[15px] font-semibold underline underline-offset-[3px]"
        >
          {copy.toSessions}
        </Link>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      <ul className="flex flex-col">
        {next.map((session) => {
          const day = formatLocalDate(session.starts_at)
          return (
            <li
              key={session.event_id}
              className="relative flex min-h-16 items-center gap-3 border-b border-border py-3 first:border-t"
            >
              <Link
                href={`/admin/sessions/${session.event_id}/work`}
                className="flex min-w-0 flex-1 flex-col gap-1 rounded-[4px] after:absolute after:inset-0 after:content-['']"
              >
                <span className="text-lg leading-[1.35] font-semibold">
                  <bdi>{sessionTitle(session.concept_name)}</bdi>
                </span>
                <time
                  dateTime={day}
                  className="text-[15px] text-muted-foreground"
                >
                  <bdi>{dayText(day)}</bdi>
                </time>
              </Link>
              <ChevronLeftIcon
                aria-hidden
                strokeWidth={1.5}
                className="size-5 shrink-0 text-muted-foreground"
              />
            </li>
          )
        })}
      </ul>
      {/* Under the list, a button-link to every session (user decision
        2026-10-08). */}
      <Link
        href="/admin/sessions"
        className="inline-flex min-h-11 items-center self-start text-[15px] underline underline-offset-[3px]"
      >
        {copy.allBrunches}
      </Link>
    </div>
  )
}
