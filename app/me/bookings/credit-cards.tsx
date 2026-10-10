import { buttonClass } from "@/components/shared/button-class"
import { SessionCard } from "@/components/shared/session-card"
import { customerCopy } from "@/lib/copy/customer"
import type { SessionPhotoData } from "@/lib/media/photo"
import { formatAgorot } from "@/lib/money"
import { formatDayMonth } from "@/lib/time"

import { activeOptions, type MyCredit } from "./credits"

// The cards of her cancellation credits and refund requests on
// /me/bookings (story 3.7). Every value comes from get_my_credits.

function CreditTitle({ credit, id }: { credit: MyCredit; id: string }) {
  return (
    <h2 id={id} className="font-heading text-[22px] leading-[1.25] font-light">
      <bdi>
        {customerCopy.creditTitle(formatDayMonth(credit.originStartsAt))}
      </bdi>
    </h2>
  )
}

// A credit she can book with: its title names the cancelled session; its
// active options as session-cards (each to its page, where the booking
// sheet says it uses the credit), or the waiting line while the next
// sessions are not published.
export function CreditCard({
  credit,
  photos,
}: {
  credit: MyCredit
  photos: ReadonlyMap<string, SessionPhotoData | null>
}) {
  const options = activeOptions(credit)
  const id = `credit-${credit.creditId}`
  return (
    <section
      aria-labelledby={id}
      className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4"
    >
      <CreditTitle credit={credit} id={id} />
      {options.length > 0 ? (
        <>
          <p className="text-[15px]">{customerCopy.creditOptions}</p>
          <ul className="flex flex-col gap-4">
            {options.map((option) => (
              <li key={option.eventId}>
                <SessionCard
                  href={`/me/sessions/${option.eventId}`}
                  conceptName={option.conceptName}
                  photo={photos.get(option.eventId) ?? null}
                  startsAt={option.startsAt}
                  headingLevel={3}
                  layout="horizontal"
                  showTime
                />
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className="text-[15px] text-muted-foreground">
          {customerCopy.creditWaiting}
        </p>
      )}
    </section>
  )
}

// A credit whose N options all went by unused (user decision 2026-10-10):
// a muted card with the contact button ("צרי קשר", WhatsApp; left out
// without published business details).
export function ExhaustedCreditCard({
  credit,
  contactHref,
}: {
  credit: MyCredit
  contactHref: string | null
}) {
  const id = `credit-${credit.creditId}`
  return (
    <section
      aria-labelledby={id}
      className="flex flex-col items-start gap-3 rounded-lg bg-muted p-4"
    >
      <CreditTitle credit={credit} id={id} />
      <p className="text-[15px] text-muted-foreground">
        {customerCopy.creditExhausted}
      </p>
      {contactHref && (
        <a
          href={contactHref}
          target="_blank"
          rel="noopener noreferrer"
          className={buttonClass({
            variant: "outline",
            size: "lg",
            className: "h-12 w-full max-w-xs border-foreground text-base",
          })}
        >
          {customerCopy.contactPhrase}
        </a>
      )}
    </section>
  )
}

// An open refund request: received, not done; never "הוחזר" before Tal
// completes it (3.9).
export function RefundCard({ credit }: { credit: MyCredit }) {
  const id = `refund-${credit.creditId}`
  return (
    <section
      aria-labelledby={id}
      className="flex flex-col gap-1 rounded-lg border border-border bg-card p-4"
    >
      <h2 id={id} className="text-[17px] font-semibold">
        <bdi>
          {customerCopy.refundTitle(
            formatAgorot(credit.refund?.amountAgorot ?? 0)
          )}
        </bdi>
      </h2>
      <p className="text-[15px] text-muted-foreground">
        {customerCopy.refundNote}
      </p>
    </section>
  )
}
