import Link from "next/link"
import { ChevronLeftIcon } from "lucide-react"

import { SummaryCard } from "@/components/admin/summary-card"
import { buttonVariants } from "@/components/ui/button"
import { adminCopy } from "@/lib/copy/admin"
import { formatLocalDate, formatSessionDateTime } from "@/lib/time"

import { upcomingRowText } from "../home-items"
import { sessionTitle } from "../sessions/session-draft"
import { detailsSummary, loadEventDetails } from "../sessions/[id]/load-details"
import { HomeLink, HomeSection } from "./home-section"
import { loadHome } from "./load-home"

const copy = adminCopy.home

// The next session and the ones after it (story 4.1; user decision
// 2026-10-06). The next one: its date, title, the summary-card from
// admin_get_event_details (babies and allergies counted exactly as on the
// session page), "לפרטי המפגש" and "לדף העבודה" (story 4.9). Then up to three
// rows "בראנץ׳ {concept} · {יום DD.MM} · {occupied}/{capacity}", each to its
// session, and "לכל המפגשים". Occupied places come from the server.
export async function NextSessions() {
  const { upcoming_sessions: sessions } = await loadHome()
  const [next, ...later] = sessions
  const details = next ? await loadEventDetails(next.event_id) : null

  if (!next || !details) {
    return (
      <HomeSection id="home-next" title={copy.nextSession}>
        <p className="text-base text-muted-foreground">{copy.noSessions}</p>
        <div>
          <HomeLink href="/admin/sessions">{copy.toSessions}</HomeLink>
        </div>
      </HomeSection>
    )
  }

  return (
    <>
      <HomeSection id="home-next" title={copy.nextSession}>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <p className="text-[15px] text-muted-foreground">
              <time dateTime={formatLocalDate(details.startsAt)}>
                <bdi>{formatSessionDateTime(details.startsAt)}</bdi>
              </time>
            </p>
            <p className="text-lg leading-[1.35] font-semibold">
              <bdi>{sessionTitle(details.conceptName)}</bdi>
            </p>
          </div>
          <SummaryCard summary={detailsSummary(details)} />
          <Link
            href={`/admin/sessions/${details.id}`}
            className={buttonVariants({
              size: "lg",
              className: "h-12 w-full text-base",
            })}
          >
            {copy.sessionDetails}
          </Link>
          <Link
            href={`/admin/sessions/${details.id}/work`}
            className={buttonVariants({
              variant: "outline",
              size: "lg",
              className: "h-12 w-full border-foreground text-base",
            })}
          >
            {copy.workSheet}
          </Link>
          {later.length === 0 && (
            <div>
              <HomeLink href="/admin/sessions">{copy.allSessions}</HomeLink>
            </div>
          )}
        </div>
      </HomeSection>

      {later.length > 0 && (
        <HomeSection
          id="home-upcoming"
          title={copy.upcoming}
          aside={<HomeLink href="/admin/sessions">{copy.allSessions}</HomeLink>}
        >
          <ul className="flex flex-col">
            {later.slice(0, 3).map((session) => (
              <li
                key={session.event_id}
                className="relative flex min-h-11 items-center gap-2.5 border-b border-border py-3 first:border-t"
              >
                <Link
                  href={`/admin/sessions/${session.event_id}`}
                  className="min-w-0 flex-1 rounded-[4px] text-base after:absolute after:inset-0 after:content-['']"
                >
                  <time dateTime={formatLocalDate(session.starts_at)}>
                    <bdi>{upcomingRowText(session)}</bdi>
                  </time>
                </Link>
                <ChevronLeftIcon
                  aria-hidden
                  strokeWidth={1.5}
                  className="size-5 shrink-0 text-muted-foreground"
                />
              </li>
            ))}
          </ul>
        </HomeSection>
      )}
    </>
  )
}
