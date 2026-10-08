import Link from "next/link"
import { ChevronLeftIcon } from "lucide-react"

import { BalanceCard } from "@/components/customer/balance-card"
import { HomeCard } from "@/components/customer/home-card"
import { ResultNoticeHost } from "@/components/shared/result-notice"
import { SessionCard } from "@/components/shared/session-card"
import { StatusChip } from "@/components/shared/status-chip"
import { buttonClass } from "@/components/shared/button-class"
import { getWhatsappHref } from "@/lib/content/business-details"
import { customerCopy } from "@/lib/copy/customer"
import type { SessionPhotoData } from "@/lib/media/photo"
import { callRpc } from "@/lib/rpc"
import { getPublicSession } from "@/lib/sessions/public"
import { createClient } from "@/lib/supabase/server"
import { formatAccessibleDate, formatDayMonth, formatWeekday } from "@/lib/time"

import { parseMyBookings } from "./bookings/cancel-result"
import { loadMyEntitlements } from "./load-entitlements"
import {
  isEmptyHome,
  isHomeCard,
  isHomeReturned,
  type SessionRow,
} from "./purchase-items"

// The home (story 4.12; design round, user decisions 2026-10-07/08), each
// section under a real heading, in this order: her next session (her
// nearest confirmed booking, a frameless session-card with its photo and
// time); "הכרטיסייה שלי", each active card as a home-card; an entry that
// returned after a cancelled pinned booking (story 3.6, a balance-card);
// "הבראנצ׳ים הקרובים שלי", the later ones, one row each with only the
// weekday and date, linking to its page; then "לכל ההרשמות שלי" (the
// cancel is only on the session page, user decision 2026-10-06). No
// message blocks and no receipts (the receipts are in the purchase
// history, its own tab). A card that ended leaves home; a pinned purchase
// shows only as its session. With neither a session ahead nor an active
// card: the empty-state. The card's values come from get_my_entitlements,
// the sessions from get_my_bookings; RLS limits the other reads to her own
// rows.
export async function Home() {
  const supabase = await createClient()
  const [entitlements, bookingsResult, contactHref] = await Promise.all([
    loadMyEntitlements(supabase),
    callRpc(supabase, "get_my_bookings"),
    getWhatsappHref(),
  ])
  if (!bookingsResult.ok) throw new Error("get_my_bookings failed")

  // Her confirmed bookings whose session has not started, by starts_at
  // (get_my_bookings decides; story 3.6).
  const myBookings = parseMyBookings(bookingsResult.data)
  const upcoming: SessionRow[] = myBookings.upcoming.map((b) => ({
    id: b.eventId,
    starts_at: b.startsAt,
    concept_name: b.conceptName,
  }))
  const cards = entitlements.filter(isHomeCard)
  const returned = entitlements.filter(isHomeReturned)

  // One host around both states, so a cancel's result stays after the
  // page is read again, also when home becomes empty (story 3.6).
  if (isEmptyHome(upcoming.length, cards.length, returned.length)) {
    return (
      <ResultNoticeHost>
        <EmptyHome contactHref={contactHref} />
      </ResultNoticeHost>
    )
  }

  const [next, ...later] = upcoming
  const nextPhoto = next ? await nextSessionPhoto(supabase, next.id) : null
  const allBookingsLink = (
    <Link
      href="/me/bookings"
      className="inline-flex min-h-11 items-center self-start text-[15px] underline underline-offset-[3px]"
    >
      {customerCopy.allMyBookings}
    </Link>
  )
  // The design round's order (user decision 2026-10-07, EXPERIENCE ›
  // Information Architecture): her next session, her card, an entry that
  // returned, the later sessions and then "לכל ההרשמות שלי". A thin rule
  // between the sections, 32 above and below it (user decision 2026-10-08).
  return (
    <ResultNoticeHost className="flex flex-col gap-8 pb-8 [&>section~section]:border-t [&>section~section]:border-border [&>section~section]:pt-8">
      {next && (
        <HomeSection id="next" title={customerCopy.upcomingTitle}>
          <SessionCard
            href={`/me/sessions/${next.id}`}
            conceptName={next.concept_name}
            photo={nextPhoto}
            startsAt={next.starts_at}
            headingLevel={3}
            photoAspect="aspect-[5/2]"
            framed={false}
            showTime
            statusText={customerCopy.booked}
            status={
              <StatusChip tone="booked">{customerCopy.booked}</StatusChip>
            }
          />
        </HomeSection>
      )}

      {cards.length > 0 && (
        <HomeSection id="card" title={customerCopy.cardTitle}>
          <ul className="flex flex-col gap-6">
            {cards.map((card, i) => (
              <li key={card.id}>
                <HomeCard
                  href={`/me/purchases/${card.id}`}
                  productName={card.productName}
                  available={card.available}
                  reserved={card.reserved}
                  used={card.used}
                  total={card.originalUnits}
                  expiresOn={card.expiresOn}
                  daysLeft={card.daysLeft}
                  isExpiring={card.isExpiring}
                  prominent={i === 0}
                />
              </li>
            ))}
          </ul>
        </HomeSection>
      )}

      {returned.length > 0 && (
        <HomeSection id="returned" title={customerCopy.returnedTitle}>
          <ul className="flex flex-col gap-3">
            {returned.map((entry) => (
              <li key={entry.id}>
                <BalanceCard
                  href={`/me/purchases/${entry.id}`}
                  productName={entry.productName}
                  used={entry.used}
                  reserved={entry.reserved}
                  total={entry.originalUnits}
                  expiresOn={entry.expiresOn}
                  daysLeft={entry.daysLeft}
                  isExpiring={entry.isExpiring}
                  awaiting={entry.awaitingSessions}
                  counts={entry.kind === "card"}
                />
              </li>
            ))}
          </ul>
        </HomeSection>
      )}

      {later.length > 0 && (
        <HomeSection id="later" title={customerCopy.moreUpcomingTitle}>
          <ul className="flex flex-col divide-y divide-border border-y border-border">
            {later.map((session) => (
              <li key={session.id}>
                <Link
                  href={`/me/sessions/${session.id}`}
                  className="flex min-h-12 items-center justify-between gap-3 rounded-lg py-3 text-base"
                >
                  <span className="sr-only">
                    {customerCopy.sessionTitle(session.concept_name)},{" "}
                    {formatAccessibleDate(session.starts_at)}
                  </span>
                  <time aria-hidden dateTime={session.starts_at}>
                    {formatWeekday(session.starts_at)}{" "}
                    <bdi className="font-semibold">
                      {formatDayMonth(session.starts_at)}
                    </bdi>
                  </time>
                  <ChevronLeftIcon
                    aria-hidden
                    strokeWidth={1.5}
                    className="size-5 shrink-0 text-muted-foreground"
                  />
                </Link>
              </li>
            ))}
          </ul>
          {allBookingsLink}
        </HomeSection>
      )}

      {/* Without later sessions, the link is still the home's last element. */}
      {next && later.length === 0 && allBookingsLink}
    </ResultNoticeHost>
  )
}

// The photo of her next session (design round, user decision 2026-10-08):
// the existing one (the session's, else its concept's), read by id with
// the existing reader; get_my_bookings has no photo. Without one, or when
// the read fails, the card shows its muted surface.
async function nextSessionPhoto(
  supabase: Awaited<ReturnType<typeof createClient>>,
  id: string
): Promise<SessionPhotoData | null> {
  try {
    return (await getPublicSession(id, supabase))?.photo ?? null
  } catch {
    return null
  }
}

// One section of home: a real heading in display-sm (design round
// 2026-10-07), then its content 12px under it.
function HomeSection({
  id,
  title,
  children,
}: {
  id: string
  title: string
  children: React.ReactNode
}) {
  return (
    <section aria-labelledby={`${id}-title`} className="flex flex-col gap-3">
      <h2
        id={`${id}-title`}
        className="font-heading text-[22px] leading-[1.25] font-light"
      >
        {title}
      </h2>
      {children}
    </section>
  )
}

// EXPERIENCE.md › State Patterns: no session ahead and no active card. The
// contact button opens WhatsApp (to buy again); without published business
// details it is left out. The purchases stay in their tab.
function EmptyHome({ contactHref }: { contactHref: string | null }) {
  return (
    <section
      aria-labelledby="empty-title"
      className="flex flex-col items-start gap-4 py-12"
    >
      <h2
        id="empty-title"
        className="font-heading text-[26px] leading-[1.2] font-light"
      >
        {customerCopy.emptyHomeTitle}
      </h2>
      {contactHref && (
        <a
          href={contactHref}
          target="_blank"
          rel="noopener noreferrer"
          className={buttonClass({
            size: "lg",
            className: "h-12 w-full max-w-xs text-base",
          })}
        >
          {customerCopy.contactPhrase}
        </a>
      )}
    </section>
  )
}
