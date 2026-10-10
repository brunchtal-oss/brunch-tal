import { OccupancyBar } from "@/components/admin/occupancy-bar"
import { adminCopy } from "@/lib/copy/admin"
import { cn } from "@/lib/utils"

import type { SessionTileItem } from "../home-items"
import { HomeLink } from "./home-section"

const copy = adminCopy.home
const summary = adminCopy.sessions.summary

// DESIGN.md › session-tile (design round, user decision 2026-10-07): a cube
// for each of the two nearest sessions, one under the other. The next one:
// "המפגש הבא" (its heading, in label), the session name, the weekday and
// date (no time, 2026-10-08), the occupancy bar, then three values, places
// "X/N", babies and allergies (numeral-lg over label; allergies in
// warning). No "נרשמות", which repeats the places. The second: the name,
// the date with "X/N" at inline-end, the bar. Each ends with "לפרטי המפגש"
// as a button-link, its only link (2026-10-08: "לדף העבודה" left it).
export function SessionTile({
  session,
  next,
}: {
  session: SessionTileItem
  // The next session's babies and allergies (admin_get_event_details);
  // absent on the second tile.
  next?: { babies: number; allergies: number }
}) {
  const headingId = `home-tile-${session.id}`
  const date = (
    <p className="text-[15px] leading-[1.5]">
      <time dateTime={session.dayAt}>
        <bdi>{session.day}</bdi>
      </time>
    </p>
  )
  return (
    <section
      aria-labelledby={headingId}
      className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4"
    >
      <div className="flex flex-col gap-1">
        {next ? (
          <>
            <h2
              id={headingId}
              className="text-[13px] leading-[1.4] text-muted-foreground"
            >
              {copy.nextSession}
            </h2>
            <p className="text-lg leading-[1.35] font-semibold">
              <bdi>{session.title}</bdi>
            </p>
            {date}
          </>
        ) : (
          <>
            <h2 id={headingId} className="text-lg leading-[1.35] font-semibold">
              <bdi>{session.title}</bdi>
            </h2>
            <div className="flex items-baseline justify-between gap-3">
              {date}
              <p className="text-[26px] leading-none tabular-nums">
                <bdi dir="ltr">{session.places}</bdi>
                <span className="sr-only"> {summary.places}</span>
              </p>
            </div>
          </>
        )}
      </div>
      <OccupancyBar percent={session.fillPercent} />
      {next && (
        <ul className="flex flex-wrap gap-x-6 gap-y-3">
          <Figure value={session.places} label={summary.places} />
          <Figure value={String(next.babies)} label={summary.babies} />
          <Figure
            value={String(next.allergies)}
            label={summary.allergies}
            highlight
          />
        </ul>
      )}
      <HomeLink href={session.href}>{copy.sessionDetails}</HomeLink>
    </section>
  )
}

// A value over its label, read together ("6 תינוקות").
function Figure({
  value,
  label,
  highlight = false,
}: {
  value: string
  label: string
  highlight?: boolean
}) {
  return (
    <li className="flex flex-col gap-1">
      <span
        className={cn(
          "text-[26px] leading-none tabular-nums",
          highlight && "text-warning"
        )}
      >
        <bdi dir="ltr">{value}</bdi>
      </span>{" "}
      <span className="text-[13px] leading-[1.4] text-muted-foreground">
        {label}
      </span>
    </li>
  )
}
