import { Suspense } from "react"
import type { Metadata } from "next"
import Link from "next/link"

import { PageHeading } from "@/components/shared/page-heading"
import { StatusChip } from "@/components/shared/status-chip"
import { adminCopy } from "@/lib/copy/admin"
import { shellCopy } from "@/lib/copy/shell"
import { formatLocalDate } from "@/lib/time"

import { BackLink } from "../back-link"
import { customerHref } from "../../customer-items"
import { toBookingItem } from "../card-items"
import { loadCard } from "../load-card"

const copy = adminCopy.customers.card

export const metadata: Metadata = {
  title: copy.bookingsTitle,
}

// A customer's booking history (story 4.2, phone check, user decision
// 2026-10-07): every booking, latest session first, each linking to its
// session. From admin_get_customer.
export default function CustomerBookingsPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  return (
    <Suspense
      fallback={<p className="text-muted-foreground">{shellCopy.loading}</p>}
    >
      <BookingsContent params={params} />
    </Suspense>
  )
}

async function BookingsContent({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const card = await loadCard(id)

  return (
    <>
      <header className="flex flex-col gap-1">
        <BackLink href={customerHref(card.profile.id)}>
          {copy.backToCard}
        </BackLink>
        <PageHeading>{copy.bookingsTitle}</PageHeading>
        <p className="text-base text-muted-foreground">
          <bdi>{card.profile.full_name}</bdi>
        </p>
      </header>
      {card.bookings.length === 0 ? (
        <p className="text-base text-muted-foreground">{copy.noBookings}</p>
      ) : (
        <ul className="flex flex-col gap-4">
          {card.bookings.map((row) => {
            const item = toBookingItem(row)
            return (
              <li key={item.key} className="flex flex-col gap-1">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <Link
                    href={item.href}
                    className="inline-flex min-h-11 items-center text-base font-semibold underline underline-offset-4"
                  >
                    <bdi>{item.title}</bdi>
                  </Link>
                  <StatusChip tone={item.tone}>{item.status}</StatusChip>
                </div>
                <p className="text-[15px] text-muted-foreground">
                  <time dateTime={formatLocalDate(item.startsAt)}>
                    {item.when}
                  </time>
                  {item.couple && <>, {copy.couple}</>}
                </p>
              </li>
            )
          })}
        </ul>
      )}
    </>
  )
}
