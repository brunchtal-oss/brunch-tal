import { Suspense } from "react"
import type { Metadata } from "next"
import Link from "next/link"
import { ChevronLeftIcon } from "lucide-react"

import { BalanceCard } from "@/components/customer/balance-card"
import { PageHeading } from "@/components/shared/page-heading"
import { ResultNoticeHost } from "@/components/shared/result-notice"
import { SessionCard } from "@/components/shared/session-card"
import { StatusChip } from "@/components/shared/status-chip"
import { buttonVariants } from "@/components/ui/button"
import { getWhatsappHref } from "@/lib/content/business-details"
import { customerCopy } from "@/lib/copy/customer"
import { shellCopy } from "@/lib/copy/shell"
import { callRpc } from "@/lib/rpc"
import { createClient } from "@/lib/supabase/server"
import {
  formatAccessibleDateTime,
  formatDayMonth,
  formatWeekday,
} from "@/lib/time"

import { parseMyBookings } from "./bookings/cancel-result"
import { loadMyEntitlements } from "./load-entitlements"
import {
  isEmptyHome,
  isHomeCard,
  isHomeReturned,
  type SessionRow,
} from "./purchase-items"

export const metadata: Metadata = {
  title: shellCopy.customer.homeTitle,
}

// Rendered inside the layout's <Suspense> customer gate. Sign-out is in the
// top-bar and the unread count on its bell (story 5.7): home has no
// notifications section.
export default function MePage() {
  return (
    <>
      <PageHeading>
        <Suspense fallback={shellCopy.customer.greeting("")}>
          <Greeting />
        </Suspense>
      </PageHeading>
      <Suspense
        fallback={<p className="text-muted-foreground">{shellCopy.loading}</p>}
      >
        <Home />
      </Suspense>
    </>
  )
}

async function Greeting() {
  const supabase = await createClient()
  // RLS returns only the signed-in customer's own profile row.
  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name")
    .maybeSingle()

  return shellCopy.customer.greeting(profile?.full_name ?? "")
}

// The home (story 4.12, user decisions 2026-10-06), three sections in this
// order, each under a real heading: her next session (her nearest
// confirmed booking, a session-card); "הבראנצ׳ים הקרובים שלי", the later
// ones, one row each with only the weekday and date, linking to its page;
// and only an active card ("הכרטיסייה שלי"). No message blocks and no
// receipts (the receipts are in the purchase history, its own tab). A card
// that ended leaves home; a pinned purchase shows only as its session.
// With neither a session ahead nor an active card: the empty-state. The
// card's values come from get_my_entitlements; RLS limits the other reads
// to her own rows. Story 3.6: the sessions come from get_my_bookings, then
// "לכל ההרשמות שלי" (the cancel is only on the session page, user decision
// 2026-10-06); an entry that returned after a cancelled pinned
// booking has its own section.
async function Home() {
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
  return (
    <ResultNoticeHost className="flex flex-col gap-10">
      {next && (
        <HomeSection id="next" title={customerCopy.upcomingTitle}>
          <SessionCard
            href={`/me/sessions/${next.id}`}
            conceptName={next.concept_name}
            startsAt={next.starts_at}
            headingLevel={3}
            photoAspect="aspect-[5/2]"
            statusText={customerCopy.booked}
            status={
              <StatusChip tone="success">{customerCopy.booked}</StatusChip>
            }
          />
        </HomeSection>
      )}

      {later.length > 0 && (
        <HomeSection id="later" title={customerCopy.moreUpcomingTitle}>
          <ul className="flex flex-col divide-y divide-border border-y border-border">
            {later.map((session) => (
              <li key={session.id}>
                <Link
                  href={`/me/sessions/${session.id}`}
                  className="flex min-h-12 items-center justify-between gap-3 rounded-[4px] text-base"
                >
                  <span className="sr-only">
                    {customerCopy.sessionTitle(session.concept_name)},{" "}
                    {formatAccessibleDateTime(session.starts_at)}
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
        </HomeSection>
      )}

      {upcoming.length > 0 && (
        <Link
          href="/me/bookings"
          className="-mt-6 inline-flex min-h-11 items-center gap-1 self-start text-base font-semibold underline underline-offset-[3px]"
        >
          {customerCopy.allMyBookings}
        </Link>
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
                />
              </li>
            ))}
          </ul>
        </HomeSection>
      )}

      {cards.length > 0 && (
        <HomeSection id="card" title={customerCopy.cardTitle}>
          <ul className="flex flex-col gap-3">
            {cards.map((card) => (
              <li key={card.id}>
                <BalanceCard
                  href={`/me/purchases/${card.id}`}
                  productName={card.productName}
                  used={card.used}
                  reserved={card.reserved}
                  total={card.originalUnits}
                  expiresOn={card.expiresOn}
                  daysLeft={card.daysLeft}
                  isExpiring={card.isExpiring}
                />
              </li>
            ))}
          </ul>
        </HomeSection>
      )}
    </ResultNoticeHost>
  )
}

// One section of home: a real heading (DESIGN.md › heading face, light),
// then its content; the same spacing everywhere.
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
        className="font-heading text-xl leading-tight font-light"
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
      className="flex flex-col items-start gap-4 py-10"
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
          className={buttonVariants({
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
