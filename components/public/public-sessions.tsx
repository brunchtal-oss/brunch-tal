import Link from "next/link"
import { MessageCircleIcon } from "lucide-react"

import { ConceptHeader } from "@/components/shared/concept-header"
import { SessionCard } from "@/components/shared/session-card"
import { buttonVariants } from "@/components/ui/button"
import { customerCopy } from "@/lib/copy/customer"
import { shellCopy } from "@/lib/copy/shell"
import { formatAgorot } from "@/lib/money"
import type { PublicSession } from "@/lib/sessions/public"

const copy = shellCopy.public

// Inline links in a sentence: the vertical padding of an inline element
// grows the touch area towards 44px without changing the line's height.
const LINK =
  "rounded-[2px] py-2.5 font-semibold underline underline-offset-[3px] decoration-1"

// The public session pages (story 5.16). Presentation only: the pages read
// the sessions (lib/sessions/public.ts) and the viewer, then render these.
// A guest never sees places, availability or a regular/couple label.

/** /sessions: every upcoming session as a session-card, or the empty-state. */
export function PublicSessionList({
  sessions,
  whatsappHref,
}: {
  sessions: PublicSession[]
  whatsappHref: string | null
}) {
  if (sessions.length === 0) {
    return <NoSessions whatsappHref={whatsappHref} />
  }
  return (
    <ul className="mx-auto flex w-full max-w-[720px] flex-col gap-6 px-6 pt-8">
      {sessions.map((session) => (
        <li key={session.id}>
          <PublicSessionCard session={session} />
        </li>
      ))}
    </ul>
  )
}

export function PublicSessionCard({
  session,
  headingLevel,
  layout,
}: {
  session: PublicSession
  headingLevel?: 2 | 3
  layout?: "stacked" | "horizontal"
}) {
  return (
    <SessionCard
      href={`/sessions/${session.id}`}
      conceptName={session.concept_name}
      photo={session.photo}
      startsAt={session.starts_at}
      headingLevel={headingLevel}
      layout={layout}
    />
  )
}

// DESIGN › empty-state: the heading in display-md and one action, the
// WhatsApp link (only with a usable number).
function NoSessions({ whatsappHref }: { whatsappHref: string | null }) {
  return (
    <div className="mx-auto flex w-full max-w-[720px] flex-col items-center px-6 py-12 text-center">
      <p className="font-heading text-[26px] leading-[1.2] font-light text-balance">
        {customerCopy.sessionsEmpty}
      </p>
      {whatsappHref && (
        <a
          href={whatsappHref}
          target="_blank"
          rel="noopener noreferrer"
          className={buttonVariants({
            className:
              "mt-6 h-auto min-h-12 gap-2 rounded-[4px] px-5 py-2 text-base leading-[1.2] font-semibold whitespace-normal",
          })}
        >
          <MessageCircleIcon aria-hidden strokeWidth={1.8} className="size-5" />
          {copy.emptyPageWhatsapp}
          <span className="sr-only"> {copy.contact.opensOutside}</span>
        </a>
      )}
    </div>
  )
}

/**
 * One session page (/sessions/[id]): the concept-header (the concept name is
 * the h1), the display price when Tal set one, the description (the
 * session's, else the concept's), then the action (user's decision
 * 2026-10-05: the description above the action).
 */
export function PublicSessionView({
  session,
  action,
}: {
  session: PublicSession
  action: React.ReactNode
}) {
  return (
    <div className="mx-auto w-full max-w-[720px] px-6 pt-2">
      <ConceptHeader
        conceptName={session.concept_name}
        photo={session.photo}
        startsAt={session.starts_at}
      />
      {session.display_price_agorot !== null && (
        <p className="mt-2 text-base">
          <bdi>{formatAgorot(session.display_price_agorot)}</bdi>
        </p>
      )}
      {session.description && (
        <p className="mt-6 text-[17px] leading-[1.65] text-pretty whitespace-pre-line">
          {session.description}
        </p>
      )}
      <div className="mt-8">{action}</div>
    </div>
  )
}

/**
 * The action on a session page. A signed-in customer: "להרשמה" to the same
 * session in her area. Anyone else (a guest, an admin, an account without an
 * active profile, or a failed lookup): "להרשמה התחברי או צרי קשר"
 * (user's decision 2026-10-05), "התחברי" the login page that returns to the
 * session in her area and "צרי קשר" opening WhatsApp (plain text without a
 * usable number).
 */
export function PublicSessionAction({
  sessionId,
  customer,
  whatsappHref,
}: {
  sessionId: string
  customer: boolean
  whatsappHref: string | null
}) {
  const mine = `/me/sessions/${sessionId}`
  if (customer) {
    return (
      <Link
        href={mine}
        className={buttonVariants({
          className:
            "h-12 w-full max-w-xs rounded-[4px] px-6 text-base font-semibold",
        })}
      >
        {customerCopy.book}
      </Link>
    )
  }
  return (
    <p className="rounded-lg bg-muted px-4 py-3.5 text-center text-[17px] leading-[1.65] text-pretty">
      {copy.sessions.guestBefore}
      <Link href={`/login?next=${mine}`} className={LINK}>
        {copy.sessions.guestLogin}
      </Link>
      {copy.sessions.guestOr}
      {whatsappHref ? (
        <a
          href={whatsappHref}
          target="_blank"
          rel="noopener noreferrer"
          className={LINK}
        >
          {copy.sessions.guestContact}
          <span className="sr-only"> {copy.contact.opensOutside}</span>
        </a>
      ) : (
        copy.sessions.guestContact
      )}
    </p>
  )
}
